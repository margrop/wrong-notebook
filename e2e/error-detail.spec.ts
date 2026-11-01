import { test, expect, type Page } from './support/fixtures';
import { ADMIN_PASSWORD } from './helpers';

async function login(page: Page) {
    const hydrated = page.waitForResponse((response) => response.url().endsWith('/api/register/status'));
    await page.goto('/login');
    await hydrated;
    await page.getByLabel(/邮箱|Email/).fill('admin@localhost');
    await page.getByLabel(/^密码$|^Password$/).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await page.waitForURL('**/', { timeout: 15000 });
}

/** 详情页中标题为 title 的卡片 */
function card(page: Page, title: string | RegExp) {
    return page.locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]', { hasText: title }) });
}

test('错题详情页显示各区块，编辑后保存并在刷新后保留', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);

    // 通过接口准备错题本和错题，避免依赖 AI 识别。
    // 用物理学科：其他用例按「数学」查找错题本，名称匹配为子串匹配，不能出现「数学」字样
    const notebookRes = await page.request.post('/api/notebooks', {
        data: { name: `详情页测试-${Date.now()}`, stage: 'junior_high', subjectKey: 'physics' },
    });
    expect(notebookRes.ok()).toBeTruthy();
    const notebook = await notebookRes.json();
    const itemRes = await page.request.post('/api/error-items', {
        data: {
            subjectId: notebook.id,
            questionText: `匀速运动的物体 ${Date.now() % 1000} 秒内通过的路程`,
            answerText: 's = vt',
            analysis: '路程等于速度乘以时间。',
            knowledgePoints: ['匀速直线运动'],
        },
    });
    expect(itemRes.ok()).toBeTruthy();
    const item = await itemRes.json();

    await page.goto(`/error-items/${item.id}`);
    await expect(page.getByRole('heading', { name: '错题详情' })).toBeVisible({ timeout: 15000 });
    await expect(card(page, '题目')).toContainText('匀速运动的物体');
    await expect(card(page, '题目')).toContainText('匀速直线运动');
    await expect(card(page, '参考答案')).toContainText('s = vt');
    await expect(card(page, /^解析$/)).toContainText('路程等于速度乘以时间。');
    await expect(card(page, '你的笔记 / 答案')).toContainText('暂无笔记');

    // 年级有明确编辑入口，跨学段修改后持久保存。
    await page.getByRole('heading', { name: '试题信息' }).locator('..').getByRole('button', { name: '编辑' }).click();
    await page.getByRole('combobox', { name: '年级/学期' }).selectOption('高二下');
    await card(page, '题目').getByRole('button', { name: '保存', exact: true }).click();
    await expect(card(page, '题目')).toContainText('高二下');

    // 编辑笔记并保存
    const notes = card(page, '你的笔记 / 答案');
    await notes.getByRole('button', { name: '编辑' }).click();
    await notes.locator('textarea').fill('注意单位换算');
    await notes.getByRole('button', { name: '保存' }).click();
    await expect(notes.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
    await expect(notes).toContainText('注意单位换算');

    // 取消编辑不保存修改
    const analysis = card(page, /^解析$/);
    await analysis.getByRole('button', { name: '编辑' }).click();
    await analysis.locator('textarea').fill('不应保存的内容');
    await analysis.getByRole('button', { name: '取消' }).click();
    await expect(analysis).toContainText('路程等于速度乘以时间。');

    // 刷新后笔记仍在
    await page.reload();
    await expect(card(page, '你的笔记 / 答案')).toContainText('注意单位换算', { timeout: 15000 });
    await expect(card(page, /^解析$/)).toContainText('路程等于速度乘以时间。');
    await expect(card(page, '题目')).toContainText('高二下');
    expect((await (await page.request.get(`/api/error-items/${item.id}`)).json()).gradeSemester).toBe('高二下');

    // 删除本用例创建的错题和错题本（错题本须为空才能删除），不影响其他用例
    expect((await page.request.delete(`/api/error-items/${item.id}/delete`)).ok()).toBeTruthy();
    expect((await page.request.delete(`/api/notebooks/${notebook.id}`)).ok()).toBeTruthy();
});

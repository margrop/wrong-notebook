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

test('题目编号默认显示 6 位 ID，管理员切换为流水号后详情页显示 #编号，两种编号都能定位', async ({ page }) => {
    test.setTimeout(90000);
    await login(page);

    // 通过接口准备错题，避免依赖 AI 识别；物理学科避免与其他用例按「数学」匹配错题本冲突
    const notebookRes = await page.request.post('/api/notebooks', {
        data: { name: `编号测试-${Date.now()}`, stage: 'junior_high', subjectKey: 'physics' },
    });
    expect(notebookRes.ok()).toBeTruthy();
    const notebook = await notebookRes.json();
    const itemRes = await page.request.post('/api/error-items', {
        data: { subjectId: notebook.id, questionText: `编号测试题 ${Date.now()}`, answerText: '答案', analysis: '解析', knowledgePoints: [] },
    });
    expect(itemRes.ok()).toBeTruthy();
    const item = await itemRes.json();
    expect(item.seqNo).toBeGreaterThanOrEqual(1000);
    expect(item.shortId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{6}$/);

    // 默认（现状）：详情页显示 6 位 ID
    await page.goto(`/error-items/${item.id}`);
    await expect(page.getByRole('heading', { name: '错题详情' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: new RegExp(item.shortId) })).toBeVisible();
    await expect(page.getByText(`#${item.seqNo}`, { exact: true })).toHaveCount(0);

    // 管理员在「设置 → 通用」切换为流水号
    await page.getByRole('button', { name: '设置' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: '题目编号显示方式' }).click();
    await page.getByRole('option', { name: /流水号/ }).click();
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/settings') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存设置' }).click();
    expect((await saved).ok()).toBeTruthy();
    await page.keyboard.press('Escape');

    // 无需刷新即按新设置显示；刷新后仍保持
    await expect(page.getByText(`#${item.seqNo}`, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(`#${item.seqNo}`, { exact: true })).toBeVisible({ timeout: 15000 });

    // 错题本页按编号定位：流水号与 6 位 ID 都能打开该题
    for (const query of [`#${item.seqNo}`, item.shortId]) {
        await page.goto('/notebooks');
        const locator = page.getByRole('textbox', { name: '按编号定位题目' });
        await locator.fill(query);
        await locator.press('Enter');
        await page.waitForURL(`**/error-items/${item.id}`, { timeout: 15000 });
    }
});

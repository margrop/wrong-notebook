import { test, expect, type Page } from './support/fixtures';
import { ADMIN_PASSWORD } from './helpers';

async function login(page: Page) {
    await page.goto('/login');
    await page.getByLabel(/邮箱|Email/).fill('admin@localhost');
    await page.getByLabel(/^密码$|^Password$/).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await page.waitForURL('**/', { timeout: 15000 });
}

test('做错的题按计划出现在今日复习中，首页显示待复习数量', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);

    // 用化学学科：其他用例按「数学」查找错题本，名称匹配为子串匹配
    const notebookRes = await page.request.post('/api/notebooks', {
        data: { name: `复习测试-${Date.now()}`, stage: 'junior_high', subjectKey: 'chemistry' },
    });
    expect(notebookRes.ok()).toBeTruthy();
    const notebook = await notebookRes.json();
    const questionText = `水的化学式是什么？${Date.now() % 1000}`;
    const itemRes = await page.request.post('/api/error-items', {
        data: { subjectId: notebook.id, questionText, answerText: 'H₂O', analysis: '两个氢原子和一个氧原子。', knowledgePoints: ['化学式'] },
    });
    expect(itemRes.ok()).toBeTruthy();
    const item = await itemRes.json();

    // 三天前做错：第一轮间隔一天，前天起已到期
    const takenAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const recordRes = await page.request.post('/api/practice/record', {
        data: { errorItemId: item.id, result: 'wrong', source: 'manual', takenAt },
    });
    expect(recordRes.ok()).toBeTruthy();

    try {
        await page.goto('/');
        const dueTile = page.getByRole('link', { name: /今日待复习/ });
        await expect(dueTile).toBeVisible({ timeout: 15000 });
        await expect(dueTile).not.toContainText('–');

        await dueTile.click();
        await page.waitForURL('**/review');
        await expect(page.getByRole('heading', { name: '今日复习' })).toBeVisible();
        const entry = page.locator('div').filter({ has: page.getByText(questionText) }).filter({ has: page.getByRole('button', { name: '举一反三' }) }).last();
        await expect(entry).toBeVisible();
        await expect(entry).toContainText(/起已到期 · 第 1 \/ 6 轮/);
    } finally {
        expect((await page.request.delete(`/api/error-items/${item.id}/delete`)).ok()).toBeTruthy();
        expect((await page.request.delete(`/api/notebooks/${notebook.id}`)).ok()).toBeTruthy();
    }
});

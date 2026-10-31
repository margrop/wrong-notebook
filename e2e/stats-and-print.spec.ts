import { test, expect, type Page } from '@playwright/test';
import { ADMIN_PASSWORD } from './helpers';

async function login(page: Page) {
    await page.goto('/login');
    await page.getByLabel(/邮箱|Email/).fill('admin@localhost');
    await page.getByLabel(/^密码$|^Password$/).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await page.waitForURL('**/', { timeout: 15000 });
}

test('知识点统计按标签计数，打印预览显示所选错题本的题目和答案', async ({ page }) => {
    test.setTimeout(90000);
    await login(page);

    // 用生物学科：其他用例按「数学」查找错题本，名称匹配为子串匹配
    const suffix = Date.now() % 100000;
    const tag = `E2E 知识点 ${suffix}`;
    const notebookRes = await page.request.post('/api/notebooks', {
        data: { name: `统计打印测试-${suffix}`, stage: 'junior_high', subjectKey: 'biology' },
    });
    expect(notebookRes.ok()).toBeTruthy();
    const notebook = await notebookRes.json();

    const ids: string[] = [];
    try {
        // 题目文字差异要足够大，否则会被识别为重复录入而返回同一道题
        const questions = ['植物细胞特有的结构是什么', '光合作用发生在哪种细胞器', '人体血液中运输氧气的是哪种细胞'];
        for (let i = 1; i <= 3; i++) {
            const res = await page.request.post('/api/error-items', {
                data: {
                    subjectId: notebook.id,
                    questionText: `${questions[i - 1]}？细胞题 ${i}-${suffix}`,
                    answerText: `答案 ${i}-${suffix}`,
                    analysis: '解析',
                    knowledgePoints: [tag],
                },
            });
            expect(res.ok()).toBeTruthy();
            const created = await res.json();
            expect(created.duplicate).toBeFalsy();
            ids.push(created.id);
        }

        // 知识点统计：同一标签的 3 道题合计为 3 次
        await page.goto('/stats?tab=tag-stats');
        await expect(page.getByRole('tab', { name: '知识点统计' })).toHaveAttribute('aria-selected', 'true');
        const row = page.locator('div.space-y-1').filter({ hasText: tag });
        await expect(row.getByText('3 次', { exact: true })).toBeVisible({ timeout: 15000 });

        // 切换标签页会记录在地址中，刷新后保持
        await page.getByRole('tab', { name: '练习统计' }).click();
        await expect(page).toHaveURL(/tab=practice/);

        // 打印预览只显示该错题本的题目，并显示答案
        await page.goto(`/print-preview?subjectId=${notebook.id}`);
        await expect(page.getByRole('heading', { name: '打印预览' }).or(page.getByText('打印预览').first())).toBeVisible({ timeout: 15000 });
        for (let i = 1; i <= 3; i++) {
            await expect(page.getByText(`细胞题 ${i}-${suffix}`)).toBeVisible();
        }
        // 默认只打印题目，勾选后才显示答案；取消勾选题目后不打印该题
        await expect(page.getByText(`答案 1-${suffix}`)).not.toBeVisible();
        await page.getByRole('checkbox', { name: '显示答案' }).check();
        await expect(page.getByText(`答案 1-${suffix}`)).toBeVisible();
        const firstQuestion = page.getByRole('checkbox', { name: new RegExp(`细胞题 1-${suffix}`) });
        await expect(firstQuestion).toBeChecked();
        await firstQuestion.uncheck();
        await expect(firstQuestion).not.toBeChecked();
        await expect(page.getByRole('button', { name: /打印/ })).toBeEnabled();
    } finally {
        for (const id of ids) {
            expect((await page.request.delete(`/api/error-items/${id}/delete`)).ok()).toBeTruthy();
        }
        expect((await page.request.delete(`/api/notebooks/${notebook.id}`)).ok()).toBeTruthy();
    }
});

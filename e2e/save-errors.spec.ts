import { test, expect } from './support/fixtures';
import { viewports } from './support/flows';

for (const viewport of viewports) {
    test.describe(`保存错误提示（${viewport.name}）`, () => {
        test.use({ viewport: viewport.viewport, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch });

        test('直接录入失败保留原因与输入，重试成功才写入并跳转', async ({ page, scenario }) => {
            await scenario.login(page);
            await page.goto(`/?notebook=${scenario.book.id}`);
            await page.getByRole('tab', { name: '直接录入', exact: true }).click();
            const question = `求三角形的面积。${scenario.marker}`;
            await page.getByPlaceholder(/输入题目内容/).fill(question);
            await page.route('**/api/error-items', (route) => route.fulfill({
                status: 502, contentType: 'application/json', body: JSON.stringify({
                    message: 'QUESTION_SAVE_GRADE_FAILED', code: 'AI_ERROR', details: { reason: 'AI_AUTH_ERROR' },
                }),
            }), { times: 1 });

            await page.getByRole('button', { name: '直接保存', exact: true }).click();
            const error = page.getByRole('alert').filter({ hasText: 'AI 识别年级失败' });
            await expect(error).toBeVisible();
            await expect(error).toContainText('手动填写年级');
            await expect(error).toContainText('AI 服务认证失败');
            await expect(error).toContainText('HTTP 502');
            await expect(page.getByPlaceholder(/输入题目内容/)).toHaveValue(question);
            expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(0);

            await page.getByRole('button', { name: '直接保存', exact: true }).click();
            await page.waitForURL(`**/notebooks/${scenario.book.id}`);
            await page.reload();
            await expect(page.getByText(question, { exact: false }).first()).toBeVisible();
            expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(1);
        });
    });
}

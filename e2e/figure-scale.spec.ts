import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { ADMIN_PASSWORD } from './helpers';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect x="10" y="10" width="180" height="80" fill="none" stroke="black"/></svg>';

for (const width of [1280, 390]) {
    test(`配图比例保存、刷新和打印保持一致（${width}px）`, async ({ page }, testInfo) => {
        test.setTimeout(120000);
        await page.setViewportSize({ width, height: 900 });
        // 本用例验证配图设置，通过认证接口登录，避免开发模式下登录页水合时序影响测试。
        const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
        const login = await page.request.post('/api/auth/callback/credentials', {
            form: { csrfToken, email: 'admin@localhost', password: ADMIN_PASSWORD, json: 'true' },
        });
        expect(login.ok()).toBeTruthy();
        const session = await (await page.request.get('/api/auth/session')).json();
        expect(session.user?.email).toBe('admin@localhost');

        const suffix = randomUUID();
        const notebookResponse = await page.request.post('/api/notebooks', {
            data: { name: `配图比例测试-${suffix}`, stage: 'junior_high', subjectKey: 'biology' },
        });
        expect(notebookResponse.ok()).toBeTruthy();
        const notebook = await notebookResponse.json();
        const itemIds: string[] = [];
        try {
            const response = await page.request.post('/api/error-items', {
                data: { subjectId: notebook.id, questionText: `图示植物细胞的结构 ${suffix}`, gradeSemester: '初一上', figureSvg: svg, knowledgePoints: [] },
            });
            expect(response.status()).toBe(201);
            const item = await response.json();
            itemIds.push(item.id);
            expect(item.figureScale).toBe(100);
            expect(item.figureAlign).toBe('center');
            await page.goto(`/error-items/${item.id}`);
            const input = page.getByRole('spinbutton', { name: '配图显示比例' });
            const image = page.getByRole('img', { name: '题目配图', exact: true });
            await expect(input).toHaveValue('100');
            await image.evaluate((element: HTMLImageElement) => element.decode());
            const original = await image.boundingBox();
            expect(original).not.toBeNull();

            const slider = page.getByRole('slider', { name: '调整配图比例' });
            await slider.press('Home');
            await expect(input).toHaveValue('10');
            await slider.press('ArrowRight');
            await expect(input).toHaveValue('11');
            await input.fill('201');
            await expect(input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true })).toBeDisabled();
            await input.fill('');
            await expect(input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true })).toBeDisabled();

            await input.fill('50');
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '居右', exact: true }).click();
            await expect(image).toHaveCSS('zoom', '0.5');
            await expect(image).toHaveClass(/ml-auto/);
            const smaller = await image.boundingBox();
            expect(smaller!.width / original!.width).toBeCloseTo(0.5, 1);
            expect(smaller!.height / original!.height).toBeCloseTo(0.5, 1);
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true }).click();
            await expect(input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true })).toBeDisabled();
            const savedItem = await (await page.request.get(`/api/error-items/${item.id}`)).json();
            expect(savedItem.figureScale).toBe(50);
            expect(savedItem.figureAlign).toBe('right');
            await page.reload();
            await expect(input).toHaveValue('50');
            await expect(image).toHaveClass(/ml-auto/);
            await page.screenshot({ path: testInfo.outputPath('detail-50-percent.png'), fullPage: true });

            // 未保存的调整可以取消，恢复 100% 也需保存后才写入数据库。
            await input.fill('150');
            const larger = await image.boundingBox();
            expect(larger!.width).toBeGreaterThan(original!.width);
            const bounds = await image.locator('..').boundingBox();
            expect(larger!.width).toBeLessThanOrEqual(bounds!.width + 1);
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '取消', exact: true }).click();
            await expect(input).toHaveValue('50');

            // 请求失败时保留编辑值，并能重试保存。
            await page.route(`**/api/error-items/${item.id}`, async (route) => {
                if (route.request().method() === 'PUT') {
                    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '测试保存失败' }) });
                } else await route.continue();
            });
            await input.fill('65');
            const save = input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true });
            await save.click();
            await expect(page.getByText('保存失败', { exact: true })).toBeVisible();
            await expect(input).toHaveValue('65');
            await expect(save).toBeEnabled();
            await page.unroute(`**/api/error-items/${item.id}`);
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '取消', exact: true }).click();

            // 打印文字时使用题目保存的比例与位置，在 print 媒体下实测尺寸。
            await page.goto(`/print-preview?subjectId=${notebook.id}`);
            await page.getByRole('checkbox', { name: '原题文字' }).check();
            await expect(image).toHaveCSS('zoom', '0.5');
            await expect(image).toHaveClass(/ml-auto/);
            await image.evaluate((element: HTMLImageElement) => element.decode());
            await page.emulateMedia({ media: 'print' });
            const printed = await image.boundingBox();
            expect(printed!.width).toBeCloseTo(smaller!.width, 0);
            expect(printed!.height).toBeCloseTo(smaller!.height, 0);
            await page.screenshot({ path: testInfo.outputPath('print-50-percent.png'), fullPage: true });
            await page.emulateMedia({ media: 'screen' });

            await page.goto(`/error-items/${item.id}`);
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '恢复 100%' }).click();
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '居中', exact: true }).click();
            await input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true }).click();
            await expect(input.locator('xpath=ancestor::form').getByRole('button', { name: '保存', exact: true })).toBeDisabled();
            await page.reload();
            await expect(input).toHaveValue('100');
            await expect(image).toHaveClass(/mx-auto/);

            // 没有配图的题目不显示比例配置。
            const textResponse = await page.request.post('/api/error-items', {
                data: { subjectId: notebook.id, questionText: `没有图的血液循环文字题 ${randomUUID()}`, gradeSemester: '初一上', knowledgePoints: [] },
            });
            expect(textResponse.status()).toBe(201);
            const textItem = await textResponse.json();
            itemIds.push(textItem.id);
            await page.goto(`/error-items/${textItem.id}`);
            await expect(page.getByText('没有图的血液循环文字题', { exact: false })).toBeVisible();
            await expect(input).toHaveCount(0);
        } finally {
            for (const id of itemIds) {
                expect((await page.request.delete(`/api/error-items/${id}/delete`)).ok()).toBeTruthy();
            }
            expect((await page.request.delete(`/api/notebooks/${notebook.id}`)).ok()).toBeTruthy();
        }
    });
}

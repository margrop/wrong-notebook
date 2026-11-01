import { expect, test } from './support/fixtures';
import { ADMIN_PASSWORD } from './helpers';

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15000, navigationTimeout: 30000 });

for (const viewport of [{ name: '桌面', width: 1280, height: 900 }, { name: '手机', width: 390, height: 844 }]) {
    test(`${viewport.name}可保存账户年级规则并手工调整单题年级`, async ({ page }) => {
        test.setTimeout(90000);
        await page.setViewportSize(viewport);
        const hydrated = page.waitForResponse((response) => response.url().endsWith('/api/register/status'));
        await page.goto('/login');
        await hydrated;
        await page.getByLabel(/邮箱|Email/).fill('admin@localhost');
        await page.getByLabel(/^密码$|^Password$/).fill(ADMIN_PASSWORD);
        await page.getByRole('button', { name: /登录|Login/ }).click();
        await page.waitForURL('**/');

        const original = await (await page.request.get('/api/user')).json();
        const ids: string[] = [];
        try {
            expect((await page.request.patch('/api/user', { data: { gradeRecognitionMode: 'fixed', fixedGradeSemester: null } })).ok()).toBeTruthy();
            await page.getByRole('button', { name: '设置', exact: true }).click();
            await page.locator('#question-grade-mode').selectOption('fixed');
            await page.locator('#question-fixed-grade').selectOption('三年级下');
            await page.getByRole('button', { name: '保存年级规则' }).click();
            await expect(page.getByRole('status').filter({ hasText: '设置已保存' })).toBeVisible();
            await expect(page.getByRole('button', { name: '保存年级规则' })).toBeDisabled();
            expect(await (await page.request.get('/api/user')).json()).toMatchObject({ gradeRecognitionMode: 'fixed', fixedGradeSemester: '三年级下' });

            await page.reload();
            await page.getByRole('button', { name: '设置', exact: true }).click();
            await expect(page.locator('#question-grade-mode')).toHaveValue('fixed');
            await expect(page.locator('#question-fixed-grade')).toHaveValue('三年级下');
            await page.screenshot({ path: test.info().outputPath(`${viewport.width}-grade-settings.png`), fullPage: true });
            await page.keyboard.press('Escape');

            const fixedResponse = await page.request.post('/api/error-items', { data: {
                questionText: `固定年级录入-${crypto.randomUUID()}`, recognizedGradeSemester: '高二下',
            } });
            expect(fixedResponse.status()).toBe(201);
            const fixed = await fixedResponse.json();
            ids.push(fixed.id);
            expect(fixed.gradeSemester).toBe('三年级下');

            // 无所属错题本也能保存年级，刷新后仍保留手工选择。
            await page.goto(`/error-items/${fixed.id}`);
            const editMetadataButton = page.getByRole('heading', { name: '试题信息' }).locator('..').getByRole('button', { name: '编辑' });
            await editMetadataButton.click();
            await page.locator('#detail-grade-semester').selectOption('初二上');
            await page.getByRole('button', { name: '保存', exact: true }).click();
            await expect(editMetadataButton).toBeVisible();
            await page.reload();
            expect((await (await page.request.get(`/api/error-items/${fixed.id}`)).json()).gradeSemester).toBe('初二上');

            await page.getByRole('button', { name: '设置', exact: true }).click();
            await page.locator('#question-grade-mode').selectOption('ai');
            await expect(page.locator('#question-fixed-grade')).toHaveCount(0);
            await page.getByRole('button', { name: '保存年级规则' }).click();
            await expect(page.getByRole('status').filter({ hasText: '设置已保存' })).toBeVisible();
            await expect(page.getByRole('button', { name: '保存年级规则' })).toBeDisabled();
            const aiResponse = await page.request.post('/api/error-items', { data: {
                questionText: `识别题目年级-${crypto.randomUUID()}`, recognizedGradeSemester: '高二下',
            } });
            expect(aiResponse.status()).toBe(201);
            const recognized = await aiResponse.json();
            ids.push(recognized.id);
            expect(recognized.gradeSemester).toBe('高二下');
            expect((await (await page.request.get(`/api/error-items/${fixed.id}`)).json()).gradeSemester).toBe('初二上');
            await page.reload();
            await page.getByRole('button', { name: '设置', exact: true }).click();
            await expect(page.locator('#question-grade-mode')).toHaveValue('ai');
        } finally {
            for (const id of ids) await page.request.delete(`/api/error-items/${id}/delete`);
            await page.request.patch('/api/user', { data: { gradeRecognitionMode: original.gradeRecognitionMode, fixedGradeSemester: original.fixedGradeSemester } });
        }
    });
}

import { resolve } from 'node:path';
import { expect, test } from './support/fixtures';
import { batchOf, calls, expectNoHorizontalOverflow, expectNotCovered, saveShot } from './support/batch-flows';
import { viewports } from './support/flows';

const PAGE_PHOTO = resolve('src/__tests__/fixtures/images/multi-question-page.jpg');

for (const profile of viewports) {
    test.describe(`照片 ${profile.name}`, () => {
        test.use({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch });

        test('[E2E-B03] 一张含多题的照片自动分题：真实图片交给模型，预览区域，确认后逐题裁片识别入库', async ({ page, scenario }, testInfo) => {
            await scenario.control({ distinctAnalysis: true });
            await scenario.login(page);
            await page.goto(`/notebooks/${scenario.book.id}/add`);
            await page.locator('input[type="file"]').first().setInputFiles(PAGE_PHOTO);
            await page.getByRole('button', { name: '自动分题' }).click();
            await expect(page.getByText(/AI 自动找出每道题及其位置/)).toBeVisible();
            await page.getByRole('button', { name: '自动识别题目' }).click();
            await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
            await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题\s*·\s*已选 3 题/, { timeout: 20000 });
            const split = await calls(scenario, 'split');
            expect(split).toHaveLength(1);
            expect(split[0].hasImage).toBe(true);

            const overview = page.getByTestId('page-image-overview');
            await expect(overview.getByRole('button', { name: '第 1 题' })).toBeVisible();
            await expect(page.getByTestId('draft-item').nth(0)).toContainText('含配图');
            await expectNoHorizontalOverflow(page);
            await saveShot(page, `photo-preview-${profile.name}`, testInfo);

            // 在原图上查看/调整第 1 题区域（保持原区域）
            await page.getByTestId('draft-item').nth(0).getByRole('button', { name: '调整区域' }).first().click();
            const dialog = page.getByRole('dialog');
            await expect(dialog.getByText('题目区域')).toBeVisible();
            await dialog.getByRole('button', { name: '使用此区域' }).click();
            await expect(dialog).toHaveCount(0);

            await expectNotCovered(page, 'draft-start');
            // 取消第 3 题，只解析前两题
            await page.getByTestId('draft-item').nth(2).getByRole('checkbox').click();
            await expect(page.getByTestId('draft-summary')).toHaveText(/已选 2 题/);
            await page.getByRole('button', { name: '解析并导入 2 题' }).click();
            await expect(page.getByTestId('batch-progress')).toHaveAttribute('data-phase', 'done', { timeout: 30000 });
            await expectNoHorizontalOverflow(page);
            await saveShot(page, `photo-done-${profile.name}`, testInfo);

            const analyses = await calls(scenario, 'analysis');
            expect(analyses).toHaveLength(2);
            expect(analyses.every((call) => call.hasImage)).toBe(true);
            const batch = await batchOf(scenario);
            const items = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id } });
            expect(items).toHaveLength(2);
            // 每题保存的是按区域裁出的图片，不是整页图
            for (const item of items) {
                expect(item.originalImageUrl).toMatch(/^data:image\/jpeg;base64,/);
                expect(item.originalImageUrl).not.toBe(batch.imageData);
                expect(item.originalImageUrl.length).toBeLessThan(batch.imageData.length);
                expect(item.subjectId).toBe(scenario.book.id);
            }
        });
    });
}

test('[E2E-B04] 照片批次开启人工确认：逐题校对后回到本批，其余按识别结果导入；刷新后进度仍在', async ({ page, scenario }) => {
    await scenario.db.user.update({ where: { id: scenario.user.id }, data: { confirmBeforeImport: true } });
    await scenario.control({ distinctAnalysis: true });
    await scenario.login(page);
    await page.goto('/');
    await page.locator('input[type="file"]').first().setInputFiles(PAGE_PHOTO);
    await page.getByRole('button', { name: '自动分题' }).click();
    await page.getByRole('button', { name: '自动识别题目' }).click();
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题/, { timeout: 20000 });
    await page.getByRole('button', { name: '解析 3 题，稍后逐题校对' }).click();
    await expect(page.getByTestId('batch-progress')).toHaveAttribute('data-phase', 'attention', { timeout: 30000 });
    await page.reload();
    await expect(page.getByTestId('batch-counts')).toContainText('待校对 3');
    expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(0);

    await page.getByTestId('batch-task').first().getByRole('link', { name: '校对' }).click();
    await expect(page).toHaveURL(/\/import-tasks\/[a-f0-9]+$/);
    const question = page.locator('textarea').first();
    await question.fill(`校对后的第 1 题 ${scenario.marker}`);
    await page.getByRole('button', { name: /保存|Save/ }).click();
    // 校对保存后回到本批题目
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
    await expect(page.getByTestId('batch-counts')).toContainText('待校对 2');
    await page.getByRole('button', { name: '按识别结果导入其余 2 题' }).click();
    await expect(page.getByTestId('batch-progress')).toHaveAttribute('data-phase', 'done', { timeout: 20000 });
    expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(3);
    expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id, questionText: `校对后的第 1 题 ${scenario.marker}` } })).toBe(1);
    expect(await calls(scenario, 'analysis')).toHaveLength(3);
});

test('[E2E-B06] 照片分题中关闭页面后从识别任务找回；部分题识别失败时只重试失败的题', async ({ page, scenario }) => {
    await scenario.control({ distinctAnalysis: true, hold: true });
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.locator('input[type="file"]').first().setInputFiles(PAGE_PHOTO);
    await page.getByRole('button', { name: '自动分题' }).click();
    await page.getByRole('button', { name: '自动识别题目' }).click();
    await expect(page.getByTestId('batch-splitting')).toBeVisible();
    await expect.poll(async () => (await calls(scenario, 'split')).length).toBe(1);
    // 模型仍在分题时关闭原页面
    await page.close();
    await scenario.control({ hold: false });

    const context = page.context();
    const next = await context.newPage();
    await scenario.guardPage(next);
    await next.goto('/import-tasks');
    const card = next.getByTestId('import-batch-card');
    await expect(card).toHaveAttribute('data-phase', 'draft', { timeout: 20000 });
    await expect(card).toContainText('一批 3 题');
    await expect(next.getByTestId('import-tasks-unread')).toBeVisible();
    await card.getByRole('link', { name: '打开' }).click();
    await expect(next.getByTestId('draft-summary')).toHaveText(/识别出 3 题/);

    await scenario.control({ failNext: 1 });
    await next.getByRole('button', { name: '解析并导入 3 题' }).click();
    await expect(next.getByTestId('batch-progress')).toHaveAttribute('data-phase', 'attention', { timeout: 30000 });
    await expect(next.getByTestId('batch-counts')).toContainText('失败 1');
    expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(2);
    await next.getByRole('button', { name: '重试失败的 1 题' }).click();
    await expect(next.getByTestId('batch-progress')).toHaveAttribute('data-phase', 'done', { timeout: 30000 });
    expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(3);
    // 3 题各识别一次，失败的一题重试一次；分题只调用一次
    expect(await calls(scenario, 'analysis')).toHaveLength(4);
    expect(await calls(scenario, 'split')).toHaveLength(1);
    const batch = await batchOf(scenario);
    expect(batch.tasks.every((task) => task.status === 'saved')).toBe(true);
});

for (const profile of viewports) {
    test.describe(`续页 ${profile.name}`, () => {
        test.use({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch });

        test('[E2E-B09] 照片分题的最后一题接到下一页：这道题的区域放在下一页上方拼图后自动分题，本批移出这道题', async ({ page, scenario }, testInfo) => {
            await scenario.login(page);
            await page.goto(`/notebooks/${scenario.book.id}/add`);
            await page.locator('input[type="file"]').first().setInputFiles(PAGE_PHOTO);
            await page.getByRole('button', { name: '自动分题' }).click();
            await page.getByRole('button', { name: '自动识别题目' }).click();
            await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题/, { timeout: 20000 });
            const firstUrl = page.url();

            // 模型没有标记截断时，只有最后一题提供续页
            const items = page.getByTestId('draft-item');
            await expect(page.getByTestId('draft-continue')).toHaveCount(1);
            await expect(items.nth(2).getByTestId('draft-continue')).toHaveText('下一页接着这题');
            await expectNoHorizontalOverflow(page);
            await saveShot(page, `continuation-${profile.name}`, testInfo);

            const [chooser] = await Promise.all([page.waitForEvent('filechooser'), items.nth(2).getByTestId('draft-continue').click()]);
            // 不限定拍照，手机上由系统提供拍照或相册
            expect(await chooser.element().getAttribute('capture')).toBeNull();
            await chooser.setFiles(PAGE_PHOTO);
            await expect(page.getByTestId('continuation-notice')).toContainText('第 2 页正在分题');
            await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 2 题/);
            expect(await calls(scenario, 'split')).toHaveLength(2);

            const [first, second] = await scenario.db.importBatch.findMany({ where: { userId: scenario.user.id }, orderBy: { createdAt: 'asc' } });
            expect(second).toMatchObject({ source: 'image', subjectId: first.subjectId, targetSubjectId: first.targetSubjectId });
            const firstInfo = JSON.parse(first.imageInfo!);
            const secondInfo = JSON.parse(second.imageInfo!);
            expect(secondInfo.sourceType).toBe('continuation');
            // 下一页上方多了上一页这道题的区域，拼图比单页更高
            expect(secondInfo.outputHeight / secondInfo.outputWidth).toBeGreaterThan(firstInfo.outputHeight / firstInfo.outputWidth);

            // 撤销可以把这道题放回本批
            await page.getByRole('button', { name: '撤销' }).click();
            await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题/);

            await page.getByTestId('continuation-notice').getByRole('link', { name: '查看' }).click();
            await expect(page).toHaveURL(new RegExp(`/import-batches/${second.id}$`));
            await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 3 题/, { timeout: 20000 });
            expect(page.url()).not.toBe(firstUrl);
        });
    });
}

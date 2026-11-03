import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { test } from './support/fixtures';
import type { Scenario } from './support/fixtures';
import { viewports } from './support/flows';

async function upload(page: Page, scenario: Scenario, path = '/') {
    await scenario.control({ hold: true });
    await scenario.login(page);
    await page.goto(path);
    await page.locator('input[type="file"]').first().setInputFiles(resolve('src/__tests__/fixtures/images/math_test.png'));
    await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toBeVisible();
    await page.getByRole('button', { name: /确认|Confirm/ }).click();
    await expect.poll(async () => (await scenario.model()).calls.filter((call) => call.operation === 'analysis').length).toBe(1);
    // 上传完成后不再全屏遮挡：页面内显示任务状态卡，页头入口显示识别中
    await expect(page.getByTestId('pending-import-task')).toBeVisible();
    await expect(page.getByTestId('pending-import-task')).toContainText('识别中');
    await expect(page.locator('.fixed.inset-0.z-50')).toHaveCount(0);
    await expect(page.getByTestId('import-tasks-entry')).toContainText('识别中 1');
}

async function snap(page: Page, testInfo: TestInfo, name: string) {
    await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

const analysisCalls = async (scenario: Scenario) => (await scenario.model()).calls.filter((call) => call.operation === 'analysis').length;

for (const profile of viewports) {
    test.describe(profile.name, () => {
        test.use({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch });

        test('[E2E-T01] 待校对结果在刷新、离开页面和新页面中都能取回，不重新识别', async ({ page, scenario, context }, testInfo) => {
            await scenario.db.user.update({ where: { id: scenario.user.id }, data: { confirmBeforeImport: true } });
            await upload(page, scenario);
            await snap(page, testInfo, `${profile.name}-pending`);

            // 模拟锁屏或离开：重新加载并切到其他页面，识别仍在服务端进行
            await page.reload();
            await page.goto('/notebooks');
            await expect(page.getByTestId('import-tasks-entry')).toContainText('识别中 1');
            await scenario.control({ hold: false });
            // 回到前台立即刷新：出现未读提示
            await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            await expect(page.getByTestId('import-tasks-unread')).toHaveText('1');
            await snap(page, testInfo, `${profile.name}-unread`);

            await page.getByTestId('import-tasks-entry').click();
            await expect(page).toHaveURL(/\/import-tasks$/);
            const card = page.getByTestId('import-task-card').first();
            await expect(card).toHaveAttribute('data-status', 'review');
            await expect(card).toContainText('AI 识别');
            await snap(page, testInfo, `${profile.name}-list`);
            await card.getByRole('button', { name: '继续校对' }).click();
            await expect(page).toHaveURL(/\/import-tasks\/[a-f0-9]+$/);
            const question = page.locator('textarea').first();
            await expect(question).toHaveValue(`求解方程 x + 2 = 5。${scenario.marker}`);
            const reviewUrl = page.url();

            // 新页面（如另一个标签页或重新打开应用）打开同一任务，得到同一结果
            const other = await context.newPage();
            await scenario.guardPage(other);
            await other.goto(reviewUrl);
            await expect(other.locator('textarea').first()).toHaveValue(`求解方程 x + 2 = 5。${scenario.marker}`);
            await other.close();
            expect(await analysisCalls(scenario)).toBe(1);

            await question.fill(`校对后的方程 x + 2 = 5。${scenario.marker}`);
            await page.getByRole('button', { name: /保存|Save/ }).click();
            await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(1);
            const task = await scenario.db.importTask.findFirstOrThrow({ where: { userId: scenario.user.id } });
            expect(task).toMatchObject({ status: 'saved', imageData: '' });
            const item = await scenario.db.errorItem.findUniqueOrThrow({ where: { id: task.errorItemId! } });
            expect(item.questionText).toBe(`校对后的方程 x + 2 = 5。${scenario.marker}`);
            expect(item.originalImageUrl).toMatch(/^data:image\/jpeg;base64,/);
            expect(await analysisCalls(scenario)).toBe(1);
        });

        test('[E2E-T02] 自动入库任务离开页面后在服务端完成，入口提示未读并可查看错题', async ({ page, scenario }, testInfo) => {
            await scenario.db.user.update({ where: { id: scenario.user.id }, data: { confirmBeforeImport: false } });
            await upload(page, scenario, `/?notebook=${scenario.book.id}`);
            await page.goto('/notebooks');
            await scenario.control({ hold: false });
            await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(1);
            await page.reload();
            await expect(page.getByTestId('import-tasks-unread')).toHaveText('1');
            await page.getByTestId('import-tasks-entry').click();
            const card = page.getByTestId('import-task-card').first();
            await expect(card).toHaveAttribute('data-status', 'saved');
            await expect(card).toContainText('数学');
            await snap(page, testInfo, `${profile.name}-saved`);
            await card.getByRole('button', { name: '查看错题' }).click();
            const item = await scenario.db.errorItem.findFirstOrThrow({ where: { userId: scenario.user.id } });
            await expect(page).toHaveURL(new RegExp(`/error-items/${item.id}$`));
            expect(item.subjectId).toBe(scenario.book.id);
            await expect.poll(async () => (await scenario.db.importTask.findFirstOrThrow({ where: { userId: scenario.user.id } })).readAt).not.toBeNull();
            expect(await analysisCalls(scenario)).toBe(1);
        });

        test('[E2E-T03] 旧任务完成时正在录入新题不被打断，由用户主动继续校对', async ({ page, scenario }) => {
            await scenario.db.user.update({ where: { id: scenario.user.id }, data: { confirmBeforeImport: true } });
            await upload(page, scenario);
            await page.getByRole('tab', { name: '手动输入', exact: true }).click();
            const draft = page.locator('#question-text');
            await draft.fill(`正在输入的新题目 ${scenario.marker}`);
            await scenario.control({ hold: false });
            const pending = page.getByTestId('pending-import-task');
            await expect(pending.getByTestId('import-task-card')).toHaveAttribute('data-status', 'review');
            // 仍停留在当前输入，内容未被清空，也没有被自动标记为已读
            await expect(draft).toHaveValue(`正在输入的新题目 ${scenario.marker}`);
            await expect(page.getByRole('heading', { name: /校对与保存/ })).toHaveCount(0);
            expect((await scenario.db.importTask.findFirstOrThrow({ where: { userId: scenario.user.id } })).readAt).toBeNull();
            await pending.getByRole('button', { name: '继续校对' }).click();
            await expect(page).toHaveURL(/\/import-tasks\/[a-f0-9]+$/);
            await expect(page.locator('textarea').first()).toHaveValue(`求解方程 x + 2 = 5。${scenario.marker}`);
            await expect.poll(async () => (await scenario.db.importTask.findFirstOrThrow({ where: { userId: scenario.user.id } })).readAt).not.toBeNull();
        });
    });
}

test('[E2E-T04] 框选 5 题先全部落库，模型排队时关闭页面后仍全部完成且不超过服务端并发上限', async ({ page, scenario }, testInfo) => {
    await scenario.db.user.update({ where: { id: scenario.user.id }, data: { confirmBeforeImport: true } });
    await scenario.control({ hold: true });
    await scenario.login(page);
    await page.goto(`/notebooks/${scenario.book.id}/add`);
    await page.locator('input[type="file"]').first().setInputFiles(resolve('src/__tests__/fixtures/images/math_test.png'));
    await page.getByRole('button', { name: '手工框选' }).click();
    const overlay = page.locator('.cursor-crosshair').first();
    await expect(overlay).toBeVisible();
    const box = (await overlay.boundingBox())!;
    for (let i = 0; i < 5; i++) {
        const top = box.y + box.height * (0.05 + i * 0.18);
        await page.mouse.move(box.x + box.width * 0.1, top);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.9, top + box.height * 0.12, { steps: 4 });
        await page.mouse.up();
    }
    await page.getByRole('button', { name: '导入 5 道题' }).click();
    // 模型被挂起时 5 题已全部上传为服务端任务
    await expect.poll(() => scenario.db.importTask.count({ where: { userId: scenario.user.id } })).toBe(5);
    await expect(page.getByTestId('batch-upload-progress')).toContainText('可以离开此页面');
    await testInfo.attach('batch-uploaded', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    const limit = (await scenario.model()).calls.length;
    expect(limit).toBeLessThanOrEqual(2);
    expect((await scenario.model()).inflight).toBeLessThanOrEqual(2);
    await page.close();

    let maxInflight = 0;
    await scenario.control({ hold: false });
    await expect.poll(async () => {
        maxInflight = Math.max(maxInflight, (await scenario.model()).inflight);
        return scenario.db.importTask.count({ where: { userId: scenario.user.id, status: 'saved' } });
    }, { timeout: 30000 }).toBe(5);
    expect(maxInflight).toBeLessThanOrEqual(2);
    expect((await scenario.model()).calls.filter((call) => call.operation === 'analysis')).toHaveLength(5);
    const tasks = await scenario.db.importTask.findMany({ where: { userId: scenario.user.id } });
    expect(tasks.every((task) => task.mode === 'auto' && task.targetSubjectId === scenario.book.id)).toBe(true);
});

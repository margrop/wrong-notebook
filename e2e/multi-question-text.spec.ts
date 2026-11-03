import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './support/fixtures';
import { batchOf, calls, expectNoHorizontalOverflow, expectNotCovered, saveShot } from './support/batch-flows';
import { viewports } from './support/flows';

const ISSUE6 = readFileSync(resolve('src/__tests__/fixtures/issue-6-nine-questions.txt'), 'utf8');

for (const profile of viewports) {
    test.describe(profile.name, () => {
        test.use({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch });

        test('[E2E-B01] issue #6 文字多题：本地分成 9 题，调整后刷新仍保留，确认后逐题解析入库，关闭页面不影响', async ({ page, scenario }, testInfo) => {
            await scenario.login(page);
            await page.goto(`/?notebook=${scenario.book.id}`);
            await page.getByRole('tab', { name: '手动输入', exact: true }).click();
            await page.locator('#question-text').fill(ISSUE6);
            await expect(page.getByTestId('multi-detected')).toContainText('检测到 9 道编号题');
            // 「作为一道题解析」仍然可用，单题路径保留
            await expect(page.getByRole('button', { name: '作为一道题解析' })).toBeEnabled();
            await page.getByRole('button', { name: '分题预览（9 题）' }).click();
            await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
            await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 9 题\s*·\s*已选 9 题/);
            // 分题不调用 AI
            expect((await scenario.model()).calls).toHaveLength(0);

            const items = page.getByTestId('draft-item');
            await expect(items).toHaveCount(9);
            await expect(items.nth(3)).toContainText('D．13.5');
            await expect(items.nth(8)).toContainText('（2）把十进制数 26 写成二进制数');
            await expectNoHorizontalOverflow(page);
            await saveShot(page, `text-preview-${profile.name}`, testInfo);

            // 取消第 9 题，编辑第 1 题
            await items.nth(8).getByRole('checkbox').click();
            await items.nth(0).getByRole('button', { name: '编辑' }).click();
            const editor = items.nth(0).getByRole('textbox', { name: '题目文字' });
            await editor.fill(`（已核对）有两根绳子 ${scenario.marker}`);
            await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved', { timeout: 10000 });
            await expect(page.getByTestId('draft-summary')).toHaveText(/已选 8 题/);

            // 刷新后从服务端取回同一草稿
            await page.reload();
            await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 9 题\s*·\s*已选 8 题/);
            await expect(page.getByTestId('draft-item').nth(0)).toContainText(`（已核对）有两根绳子 ${scenario.marker}`);

            await expectNotCovered(page, 'draft-start');
            await scenario.control({ hold: true });
            await page.getByRole('button', { name: '解析并导入 8 题' }).click();
            await expect(page.getByTestId('batch-progress')).toBeVisible();
            await expect.poll(() => scenario.db.importTask.count({ where: { userId: scenario.user.id } })).toBe(8);
            await expectNoHorizontalOverflow(page);
            await saveShot(page, `text-progress-${profile.name}`, testInfo);
            await page.close();

            // 关闭原页面后，后台继续完成全部题目
            await scenario.control({ hold: false });
            await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } }), { timeout: 30000 }).toBe(8);
            const saved = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id } });
            expect(saved.every((item) => item.subjectId === scenario.book.id)).toBe(true);
            expect(saved.map((item) => item.questionText)).toContain(`（已核对）有两根绳子 ${scenario.marker}`);
            expect(saved.find((item) => item.questionText?.includes('出租车'))?.questionText).toContain('A．8.4　　　B．10.6');
            expect(await calls(scenario, 'reanswer')).toHaveLength(8);

            // 全局入口能找到这一批，不是零散任务
            const next = await page.context().newPage();
            await scenario.guardPage(next);
            await next.goto('/import-tasks');
            const card = next.getByTestId('import-batch-card');
            await expect(card).toHaveCount(1);
            await expect(card).toContainText('一批 8 题');
            await expect(card).toHaveAttribute('data-phase', 'done');
            await expect(next.getByTestId('import-task-card')).toHaveCount(0);
        });
    });
}

test('[E2E-B02] 未编号文字用 AI 分题，部分失败只重试失败的题', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.getByRole('tab', { name: '手动输入', exact: true }).click();
    await page.locator('#question-text').fill(`计算 3 + 4，写出过程。${scenario.marker}\n\n小明有 5 个苹果，\n又买了 3 个，现在有几个？`);
    await expect(page.getByTestId('multi-detected')).toHaveCount(0);
    await page.getByRole('button', { name: /用 AI 分题/ }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 2 题/);
    expect(await calls(scenario, 'split')).toHaveLength(1);
    await expect(page.getByTestId('draft-item').nth(1)).toContainText('又买了 3 个');

    await scenario.control({ failNext: 1 });
    await page.getByRole('button', { name: '解析并导入 2 题' }).click();
    await expect(page.getByTestId('batch-progress')).toHaveAttribute('data-phase', 'attention', { timeout: 20000 });
    await expect(page.getByTestId('batch-counts')).toContainText('失败 1');
    expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(1);

    await page.getByRole('button', { name: '重试失败的 1 题' }).click();
    await expect(page.getByTestId('batch-progress')).toHaveAttribute('data-phase', 'done', { timeout: 20000 });
    expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(2);
    // 两题各成功解析一次，失败的那次重试一次，共 3 次解析
    expect(await calls(scenario, 'reanswer')).toHaveLength(3);
    const batch = await batchOf(scenario);
    expect(batch.tasks.every((task) => task.status === 'saved')).toBe(true);
});

test('[E2E-B05] 其他用户打开批次链接看不到内容', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.getByRole('tab', { name: '手动输入', exact: true }).click();
    await page.locator('#question-text').fill('1．计算 1 + 1。\n2．计算 2 + 2。');
    await page.getByRole('button', { name: '分题预览（2 题）' }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
    const url = page.url();
    await page.context().clearCookies();
    await scenario.login(page, true);
    await page.goto(url);
    await expect(page.getByText('这批题目不存在或已被放弃。')).toBeVisible();
    expect(await scenario.db.importTask.count({ where: { userId: { in: [scenario.user.id, scenario.otherUser.id] } } })).toBe(0);
});

import { test, expect } from './support/fixtures';
import { viewports } from './support/flows';
import { generatePractice, submitProof } from './support/practice-flows';

for (const profile of viewports) {
    test.describe(profile.name, () => {
        test.use({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch });
        test('[E2E-M05] 练习真实判题后确认保存并恢复暂存', async ({ page, scenario }) => {
            const item = await generatePractice(page, scenario);
            await submitProof(page);
            await expect(page.getByText('测试夹具判定：结论及论证完整', { exact: false })).toBeVisible();
            expect((await scenario.model()).calls.filter((call) => call.operation === 'grade')).toHaveLength(1);
            expect(await scenario.records()).toHaveLength(0);
            await page.getByRole('button', { name: '保存结果', exact: true }).click();
            await expect(page.getByText('结果已保存，稍后会重新评估掌握概率', { exact: true })).toBeVisible();
            const records = await scenario.records();
            expect(records).toHaveLength(1);
            expect(records[0]).toMatchObject({ errorItemId: item.id, source: 'practice', result: 'correct' });
            expect(records[0].questionText).toContain(`${scenario.marker}变式`);
            await expect.poll(async () => (await scenario.db.errorItem.findUniqueOrThrow({ where: { id: item.id } })).masteryProbability).toBe(0.7);
            await page.locator(`a[href="/error-items/${item.id}"]`).click();
            await page.getByRole('button', { name: /做对.*单题练习/ }).click();
            await expect(page.getByText(`${scenario.marker}变式`, { exact: false })).toBeVisible();
            await page.goto(`/practice?id=${item.id}`);
            await expect(page.getByText(`${scenario.marker}变式`, { exact: false })).toBeVisible();
            await page.reload();
            await expect(page.getByText(`${scenario.marker}变式`, { exact: false })).toBeVisible();
            expect((await scenario.model()).calls.filter((call) => call.operation === 'variant')).toHaveLength(1);
            expect(await scenario.records()).toHaveLength(1);
            expect((await scenario.db.errorItem.findUniqueOrThrow({ where: { id: item.id } })).questionText).toBe(item.questionText);
        });
    });
}

test('[E2E-M06] 判题失败不自动判错，用户手工确认后保存', async ({ page, scenario }) => {
    await scenario.control({ gradeError: true });
    const item = await generatePractice(page, scenario);
    await submitProof(page);
    await expect(page.getByText('暂时无法自动判定，请对照下方答案自行选择结果。', { exact: true })).toBeVisible();
    expect(await scenario.records()).toHaveLength(0);
    await page.getByRole('radio', { name: '做错', exact: true }).click();
    expect(await scenario.records()).toHaveLength(0);
    await page.getByRole('button', { name: '保存结果', exact: true }).click();
    await expect.poll(async () => (await scenario.records()).length).toBe(1);
    expect((await scenario.records())[0]).toMatchObject({ result: 'wrong', source: 'practice', errorItemId: item.id });
    await expect.poll(async () => (await scenario.db.errorItem.findUniqueOrThrow({ where: { id: item.id } })).masteryProbability).toBe(0.7);
    await page.goto(`/error-items/${item.id}`);
    await page.reload();
    await page.getByRole('button', { name: /做错.*单题练习/ }).click();
    await expect(page.getByText(`${scenario.marker}变式`, { exact: false })).toBeVisible();
    expect(await scenario.records()).toHaveLength(1);
});

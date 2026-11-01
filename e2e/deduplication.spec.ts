import { test, expect } from './support/fixtures';
import { directEntry, openSettings } from './support/flows';

async function saveThreshold(page: import('@playwright/test').Page, threshold: number) {
    const settings = await openSettings(page);
    await settings.locator('#question-duplicate-threshold').fill(String(threshold));
    await settings.locator('#question-duplicate-threshold').locator('..').getByRole('button', { name: '保存阈值', exact: true }).click();
    await expect(settings.locator('#question-duplicate-threshold').locator('..').getByRole('button', { name: '保存阈值', exact: true })).toBeDisabled();
    await page.reload();
    const reloaded = await openSettings(page);
    await expect(reloaded.locator('#question-duplicate-threshold')).toHaveValue(String(threshold));
    await page.keyboard.press('Escape');
}

test('[E2E-M08] 阈值刷新后生效且重复录入与比较保持正确记录数', async ({ page, scenario }) => {
    await scenario.control({ masteryProbability: 70 });
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await saveThreshold(page, 99);
    const question = `证明任意两个连续整数的和为奇数，并说明完整理由。${scenario.marker}`;
    const first = await directEntry(page, scenario, question);
    const duplicate = await directEntry(page, scenario, question);
    expect(duplicate).toMatchObject({ id: first.id, duplicate: true });
    await expect(page.getByText(/重复/).first()).toBeVisible();
    expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(1);
    expect(await scenario.records()).toHaveLength(1);
    expect((await scenario.records())[0]).toMatchObject({ source: 'duplicate_import', result: 'wrong', errorItemId: first.id });
    await expect.poll(async () => (await scenario.db.errorItem.findUniqueOrThrow({ where: { id: first.id } })).masteryProbability).toBe(0.7);
    await saveThreshold(page, 100);
    const separate = await directEntry(page, scenario, question);
    expect(separate.id).not.toBe(first.id);
    expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(2);
    await page.goto(`/notebooks/${scenario.book.id}`);
    await page.getByRole('button', { name: '多选', exact: true }).click();
    const checkboxes = page.getByRole('checkbox');
    for (let index = 0; index < await checkboxes.count(); index++) await checkboxes.nth(index).check();
    await page.getByRole('button', { name: /相似度/ }).click();
    const comparison = page.getByRole('dialog');
    await expect(comparison.getByText('100%', { exact: true })).toBeVisible();
    expect(await scenario.records()).toHaveLength(1);
    expect((await scenario.db.errorItem.findUniqueOrThrow({ where: { id: first.id } })).questionText).toBe(question);
});

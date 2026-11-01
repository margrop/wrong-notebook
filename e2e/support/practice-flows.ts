import { expect } from './fixtures';
import type { Page, Scenario } from './fixtures';

export async function generatePractice(page: Page, scenario: Scenario) {
    const item = await scenario.item();
    await scenario.login(page);
    await scenario.control({ hold: true, masteryProbability: 70 });
    await page.goto(`/practice?id=${item.id}`);
    const generate = page.getByRole('button', { name: '生成练习题', exact: true });
    await generate.click();
    await expect.poll(async () => (await scenario.model()).calls.filter((call) => call.operation === 'variant').length).toBe(1);
    await expect(page.getByRole('button', { name: 'AI 正在出题...', exact: true })).toBeDisabled();
    await scenario.control({ hold: false });
    await expect(page.getByText(`${scenario.marker}变式`, { exact: false })).toBeVisible();
    return item;
}

export async function submitProof(page: Page) {
    await page.getByPlaceholder('输入你的答案...').fill('令连续整数为 k 与 k+1，因此和为 2k+1，按奇数定义可得结论。');
    await page.getByRole('button', { name: '提交答案', exact: true }).click();
}

import { expect } from './fixtures';
import type { Page, Scenario } from './fixtures';

export async function createExam(page: Page, scenario: Scenario) {
    await scenario.login(page);
    await scenario.control({ hold: true, masteryProbability: 70 });
    await page.goto('/exams');
    await page.getByRole('checkbox', { name: /数学/ }).check();
    await page.getByRole('button', { name: 'A卷', exact: true }).click();
    await page.locator('#exam-count').fill('2');
    await page.getByRole('button', { name: '生成试卷', exact: true }).click();
    await page.waitForURL(/\/exams\/[^/]+$/);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    await expect.poll(async () => (await scenario.model()).calls.filter((call) => call.operation === 'variant').length).toBe(2);
    await expect(page.getByText(/生成中/).first()).toBeVisible();
    await scenario.control({ hold: false });
    return id;
}

export function questionCard(page: Page, shortId: string) {
    return page.locator('[data-slot="card"]').filter({ has: page.getByRole('link', { name: new RegExp(shortId) }) });
}

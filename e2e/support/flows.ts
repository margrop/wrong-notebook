import { resolve } from 'node:path';
import { expect } from './fixtures';
import type { Page, Scenario } from './fixtures';

export const viewports = [
    { name: '桌面', viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false },
    { name: '手机', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

export async function importImage(page: Page, scenario: Scenario, confirm: boolean) {
    await scenario.db.user.update({ where: { id: scenario.user.id }, data: { confirmBeforeImport: confirm } });
    await scenario.control({ hold: true });
    await scenario.login(page);
    await page.goto(confirm ? '/' : `/?notebook=${scenario.book.id}`);
    await page.locator('input[type="file"]').first().setInputFiles(resolve('e2e/fixtures/math_test.png'));
    await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toBeVisible();
    await page.getByRole('button', { name: /确认|Confirm/ }).click();
    await expect.poll(async () => (await scenario.model()).calls.filter((call) => call.operation === 'analysis').length).toBe(1);
    await expect(page.getByRole('progressbar')).toBeVisible();
    await scenario.control({ hold: false });
    if (confirm) {
        await expect(page.getByRole('heading', { level: 2 })).toContainText(/校对|Review|Correct/);
        const question = page.locator('textarea').first();
        await expect(question).toHaveValue(`求解方程 x + 2 = 5。${scenario.marker}`);
        await question.fill(`校对后的方程 x + 2 = 5。${scenario.marker}`);
        await expect(page.getByText('一元一次方程', { exact: true }).first()).toBeVisible();
        await page.getByRole('button', { name: /保存|Save/ }).click();
    } else await expect(page.getByRole('heading', { name: /校对|Review & Correct/ })).toHaveCount(0);
    await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(1);
    const item = await scenario.db.errorItem.findFirstOrThrow({ where: { userId: scenario.user.id }, include: { tags: true } });
    expect(item).toMatchObject({ subjectId: scenario.book.id, gradeSemester: '初二上', answerText: 'x = 3' });
    expect(item.tags.map((tag) => tag.name)).toContain('一元一次方程');
    expect((await scenario.model()).calls.find((call) => call.operation === 'analysis')?.hasImage).toBe(true);
    expect(await scenario.records()).toHaveLength(0);
    await page.goto(`/error-items/${item.id}`);
    await expect(page.getByText(item.questionText!, { exact: false }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(item.questionText!, { exact: false }).first()).toBeVisible();
    return item;
}

export async function directEntry(page: Page, scenario: Scenario, question: string, group?: string, stay = false) {
    if (!stay) await page.goto(`/?notebook=${scenario.book.id}`);
    if (!stay) await page.getByRole('tab', { name: '直接录入', exact: true }).click();
    await page.getByPlaceholder(/输入题目内容/).fill(question);
    await page.getByPlaceholder(/输入参考答案/).fill('参考答案');
    if (group) {
        await page.getByRole('combobox').filter({ hasText: /选择卷别|A卷|B卷|其他/ }).click();
        await page.getByRole('option', { name: group, exact: true }).click();
    }
    const response = page.waitForResponse((value) => value.url().endsWith('/api/error-items') && value.request().method() === 'POST');
    await page.getByRole('button', { name: '直接保存', exact: true }).click();
    const saved = await response;
    expect([200, 201]).toContain(saved.status());
    return saved.json() as Promise<{ id: string; duplicate?: boolean; paperLevel?: string | null }>;
}

export async function openSettings(page: Page, tab = '通用') {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    if (await dialog.getByRole('tab', { name: tab, exact: true }).count()) await dialog.getByRole('tab', { name: tab, exact: true }).click();
    return dialog;
}

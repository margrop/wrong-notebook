import { test, expect } from './support/fixtures';

test('[E2E-F11] 多选错题批量移动到其他错题本，标签保持不变', async ({ page, scenario }) => {
    test.setTimeout(60000);
    const target = await scenario.db.subject.create({
        data: { name: 'E2E 目标本', stage: 'junior_high', subjectKey: 'math', userId: scenario.user.id },
    });
    const item = await scenario.item('M');
    await scenario.db.errorItem.update({ where: { id: item.id }, data: { tags: { connect: [{ id: 'e2e-leaf-default' }] } } });

    await scenario.guardPage(page);
    await scenario.login(page);
    await page.goto(`/notebooks/${scenario.book.id}`);
    await expect(page.getByText(item.questionText!, { exact: false })).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: '多选', exact: true }).click();
    const card = page.locator('a', { hasText: item.questionText! }).locator('..');
    await card.getByRole('checkbox').click();
    await page.getByRole('button', { name: '移动到错题本', exact: true }).click();

    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '移动选中的错题' }) });
    await expect(dialog).toBeVisible();
    await dialog.locator('button[role="combobox"]').click();
    await page.getByRole('option', { name: 'E2E 目标本', exact: true }).click();

    const moved = page.waitForResponse((response) => response.url().includes('/api/error-items/batch-move') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '移动', exact: true }).click();
    expect((await moved).ok()).toBeTruthy();

    await expect.poll(async () => (await scenario.db.errorItem.findUnique({ where: { id: item.id } }))?.subjectId).toBe(target.id);
    const movedItem = await scenario.db.errorItem.findUnique({ where: { id: item.id }, include: { tags: true } });
    expect(movedItem?.tags.map((tag) => tag.id)).toContain('e2e-leaf-default');
    await expect(page.getByText(item.questionText!, { exact: false })).not.toBeVisible({ timeout: 15000 });
});

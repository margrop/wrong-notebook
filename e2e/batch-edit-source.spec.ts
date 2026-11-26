import { expect, test } from './support/fixtures';
import { expectNoHorizontalOverflow, saveShot } from './support/batch-flows';

/** 多选栏批量编辑来源/年级；多题预览页统一来源写入草稿 */
test('[E2E-B03] 批量编辑来源与年级，并在多题预览页统一设置来源', async ({ page, scenario }, testInfo) => {
    test.setTimeout(60000);
    const first = await scenario.item('A');
    const second = await scenario.item('B');
    await scenario.guardPage(page);
    await scenario.login(page);

    await page.goto(`/notebooks/${scenario.book.id}`);
    await expect(page.getByText(first.questionText!, { exact: false })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: '多选', exact: true }).click();
    for (const item of [first, second]) {
        await page.locator('a', { hasText: item.questionText! }).locator('..').getByRole('checkbox').click();
    }
    await page.getByRole('button', { name: '批量编辑', exact: true }).click();

    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '批量编辑 2 道错题' }) });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: '来源', exact: true }).click();
    await dialog.getByPlaceholder('如：某年期中卷（选填）').fill('期中数学试卷');
    await dialog.getByRole('checkbox', { name: '年级/学期', exact: true }).click();
    await dialog.locator('#batch-edit-grade-semester').selectOption('初二下');
    await saveShot(page, 'batch-edit-dialog', testInfo);

    const updated = page.waitForResponse((response) => response.url().includes('/api/error-items/batch-update') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
    expect((await updated).ok()).toBeTruthy();
    await expect(dialog).not.toBeVisible();
    for (const item of [first, second]) {
        const saved = await scenario.db.errorItem.findUnique({ where: { id: item.id } });
        expect(saved).toMatchObject({ source: '期中数学试卷', gradeSemester: '初二下' });
    }
    await expectNoHorizontalOverflow(page);

    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.getByRole('tab', { name: '手动输入', exact: true }).click();
    await page.locator('#question-text').fill(`1．计算 1 + 1。${scenario.marker}\n2．计算 2 + 2。`);
    await expect(page.getByTestId('multi-detected')).toContainText('检测到 2 道编号题');
    await page.getByRole('button', { name: '分题预览（2 题）' }).click();
    await expect(page).toHaveURL(/\/import-batches\/[a-f0-9]+$/);
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 2 题/);

    await page.locator('#batch-source').fill('期末数学试卷');
    await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved', { timeout: 10000 });
    await page.getByRole('button', { name: '应用到全部题目', exact: true }).click();
    await expect(page.getByTestId('draft-save-state')).toHaveAttribute('data-state', 'saved', { timeout: 10000 });
    await page.reload();
    await expect(page.locator('#batch-source')).toHaveValue('期末数学试卷');
    await expect(page.getByTestId('draft-summary')).toHaveText(/识别出 2 题/);
    await saveShot(page, 'batch-source-preview', testInfo);
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: '解析并导入 2 题' }).click();
    await expect(page.getByTestId('batch-progress')).toBeVisible();
    await expect.poll(async () => (await scenario.db.errorItem.findMany({
        where: { userId: scenario.user.id, source: '期末数学试卷' }, select: { source: true },
    })).length, { timeout: 30000 }).toBe(2);
});

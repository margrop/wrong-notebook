import { test, expect } from './support/fixtures';
import { directEntry, openSettings } from './support/flows';

test('[E2E-M02] 卷别新增改名停用同步到录入筛选与历史题目', async ({ page, scenario }) => {
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.getByRole('tab', { name: '直接录入', exact: true }).click();
    const name = `单元测试-${scenario.id}`;
    const renamed = `期中考试-${scenario.id}`;
    let dialog = await openSettings(page);
    await dialog.getByPlaceholder('如：单元测试').fill(name);
    await dialog.getByRole('button', { name: '添加', exact: true }).click();
    await expect(dialog.getByText(name, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const saved = await directEntry(page, scenario, `长方形周长的计算方法。${scenario.marker}`, name, true);
    const group = await scenario.db.paperGroup.findFirstOrThrow({ where: { userId: scenario.user.id, name } });
    expect((await scenario.db.errorItem.findUniqueOrThrow({ where: { id: saved.id } })).paperLevel).toBe(group.id);
    await page.goto(`/notebooks/${scenario.book.id}`);
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByText(`长方形周长的计算方法。${scenario.marker}`, { exact: false })).toBeVisible();
    dialog = await openSettings(page);
    const row = dialog.locator('div.rounded-lg.border.p-3').filter({ has: page.getByText(name, { exact: true }) });
    page.once('dialog', (prompt) => prompt.accept(renamed));
    await row.getByRole('button', { name: '重命名', exact: true }).click();
    await expect(dialog.getByText(renamed, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: renamed, exact: true })).toBeVisible();
    dialog = await openSettings(page);
    const renamedRow = dialog.locator('div.rounded-lg.border.p-3').filter({ has: page.getByText(renamed, { exact: true }) });
    await renamedRow.getByRole('button', { name: '停用', exact: true }).click();
    await expect(renamedRow.getByText('已停用', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto(`/error-items/${saved.id}`);
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();
    const editMetadataButton = page.getByRole('heading', { name: '试题信息' }).locator('..').getByRole('button', { name: '编辑' });
    await editMetadataButton.click();
    await page.locator('#detail-grade-semester').selectOption('高二下');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(editMetadataButton).toBeVisible();
    await page.reload();
    await expect(page.getByText('高二下', { exact: true })).toBeVisible();
    expect((await scenario.db.errorItem.findUniqueOrThrow({ where: { id: saved.id } })).paperLevel).toBe(group.id);
});

test('录入期间选中的卷别被停用，可以保留草稿并使用默认规则保存', async ({ page, scenario }) => {
    const group = await scenario.db.paperGroup.create({ data: { userId: scenario.user.id, name: '本周练习' } });
    await scenario.login(page);
    await page.goto(`/?notebook=${scenario.book.id}`);
    await page.getByRole('tab', { name: '直接录入', exact: true }).click();

    const questionText = `求一个等腰三角形的周长。${scenario.marker}`;
    const draft = page.getByPlaceholder(/输入题目内容/);
    await draft.fill(questionText);
    const paperGroup = page.getByRole('combobox', { name: '所属卷等级', exact: true });
    await paperGroup.click();
    await page.getByRole('option', { name: group.name, exact: true }).click();

    const disabled = await page.request.patch(`/api/paper-groups/${group.id}`, { data: { isActive: false } });
    expect(disabled.ok()).toBe(true);
    const submit = async () => {
        const response = page.waitForResponse((value) => value.url().endsWith('/api/error-items') && value.request().method() === 'POST');
        await page.getByRole('button', { name: '直接保存', exact: true }).click();
        return response;
    };

    const rejected = await submit();
    expect(rejected.status()).toBe(400);
    expect(await rejected.json()).toMatchObject({ message: 'QUESTION_SAVE_INVALID_PAPER_LEVEL' });
    await expect(draft).toHaveValue(questionText);
    await expect(paperGroup).toContainText('卷别不可用');
    await paperGroup.click();
    await expect(page.getByRole('option', { name: group.name, exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: '不手工指定', exact: true }).click();

    const saved = await submit();
    expect(saved.status(), await saved.text()).toBe(201);
    const item = await scenario.db.errorItem.findFirstOrThrow({ where: { userId: scenario.user.id } });
    expect(item).toMatchObject({ questionText, paperLevel: null });
});

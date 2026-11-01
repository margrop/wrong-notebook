import { test, expect } from './support/fixtures';
import { importImage } from './support/flows';
import { acceptConfirmDialog } from './helpers';

test('图片识别经人工校对后保存、刷新并删除', async ({ page, scenario }) => {
    const item = await importImage(page, scenario, true);
    await expect(page.getByText('校对后的方程', { exact: false })).toBeVisible();
    await expect(page.getByText('待复习', { exact: true }).first()).toBeVisible();
    expect(item.masteryLevel).toBe(0);
    await page.getByRole('button', { name: /^(删除|Delete)$/ }).click();
    await acceptConfirmDialog(page);
    await expect.poll(() => scenario.db.errorItem.count({ where: { id: item.id } })).toBe(0);
    await page.goto(`/notebooks/${scenario.book.id}`);
    await expect(page.getByText('共 0 道错题')).toBeVisible();
    await page.getByRole('button', { name: /^(删除|Delete)$/ }).click();
    await acceptConfirmDialog(page);
    await page.waitForURL('**/notebooks');
    expect(await scenario.db.subject.findUnique({ where: { id: scenario.book.id } })).toBeNull();
});

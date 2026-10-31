import { test, expect, type Page } from '@playwright/test';
import { acceptConfirmDialog, ADMIN_PASSWORD } from './helpers';

async function login(page: Page) {
    await page.goto('/login');
    await page.getByLabel(/邮箱|Email/).fill('admin@localhost');
    await page.getByLabel(/^密码$|^Password$/).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /登录|Login/ }).click();
    await page.waitForURL('**/', { timeout: 15000 });
}

test('新建错题本、搜索和批量删除错题，清空后删除错题本', async ({ page }) => {
    test.setTimeout(90000);
    await login(page);

    // 名称不含「数学」：其他用例按名称子串查找数学错题本
    const suffix = Date.now() % 100000;
    const notebookName = `E2E 错题本 ${suffix}`;

    await page.goto('/notebooks');
    await page.getByRole('button', { name: '新建错题本' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('错题本名称').fill(notebookName);
    await dialog.getByRole('button', { name: /^创建$/ }).click();
    await expect(dialog).not.toBeVisible();

    await page.getByText(notebookName).click();
    await page.waitForURL(/\/notebooks\/[^/]+$/);
    const notebookId = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByText('共 0 道错题')).toBeVisible();

    // 通过接口录入两道题，避免依赖 AI 识别
    const keep = `保留的题目 ${suffix}`;
    const remove = `要删除的题目 ${suffix}`;
    for (const questionText of [keep, remove]) {
        const res = await page.request.post('/api/error-items', {
            data: { subjectId: notebookId, questionText, answerText: '答案', analysis: '解析', knowledgePoints: [] },
        });
        expect(res.ok()).toBeTruthy();
        expect((await res.json()).duplicate).toBeFalsy();
    }
    await page.reload();
    await expect(page.getByText('共 2 道错题')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(keep)).toBeVisible();
    await expect(page.getByText(remove)).toBeVisible();

    // 搜索只显示匹配的题目
    const search = page.getByPlaceholder(/搜索/);
    await search.fill('要删除的');
    await expect(page.getByText(keep)).not.toBeVisible();
    await expect(page.getByText(remove)).toBeVisible();
    await search.fill('');
    await expect(page.getByText(keep)).toBeVisible();

    // 有题目时不能删除错题本
    await page.getByRole('button', { name: '删除' }).first().click();
    await expect(page.getByText('请先清空错题本中的所有题目')).toBeVisible();

    // 进入选择模式，选中一题批量删除
    await page.getByRole('button', { name: '多选' }).click();
    const card = page.locator('a', { hasText: remove }).locator('..');
    await card.getByRole('checkbox').click();
    await page.getByRole('button', { name: /删除选中/ }).click();
    await acceptConfirmDialog(page);
    await expect(page.getByText(remove)).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(keep)).toBeVisible();

    // 删除剩下的题目后，错题本可以删除，并从列表中消失
    const list = await (await page.request.get(`/api/error-items/list?subjectId=${notebookId}`)).json();
    for (const item of list.items) {
        expect((await page.request.delete(`/api/error-items/${item.id}/delete`)).ok()).toBeTruthy();
    }
    await page.goto(`/notebooks/${notebookId}`);
    await page.getByRole('button', { name: '删除' }).first().click();
    await acceptConfirmDialog(page);
    await page.waitForURL('**/notebooks');
    await expect(page.getByText(notebookName)).not.toBeVisible();
});

import { test, expect } from './support/fixtures';
import { ADMIN_PASSWORD } from './helpers';

test('管理员可从设置重新打开安装向导，跳过各步骤后回到首页', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto('/login');
    await page.locator('input[name="email"]').fill('admin@localhost');
    await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/', { timeout: 15000 });

    // 设置 → 用户管理 → 重新运行安装向导
    await page.getByRole('button', { name: /^(设置|Settings)$/ }).click();
    await page.getByRole('tab', { name: /用户管理|User Management/ }).click();
    await page.getByRole('button', { name: /重新运行安装向导|Run setup wizard again/ }).click();
    await page.waitForURL('**/setup');

    // 密码已不是默认值，向导从 AI 渠道开始，共 2 步
    await expect(page.getByText(/第 1 \/ 2 步|Step 1 of 2/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /配置 AI 渠道|Set up an AI provider/ })).toBeVisible();
    await page.getByRole('button', { name: /^(跳过|Skip)$/ }).click();

    await expect(page.getByRole('heading', { name: /创建第一个错题本|Create your first notebook/ })).toBeVisible();
    await page.getByRole('button', { name: /^(完成|Finish)$/ }).click();
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15000 });
});

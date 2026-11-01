import { test, expect } from './support/fixtures';

// setup-admin@localhost 由 scripts/prepare-e2e.js 创建，仍使用默认密码
test('管理员使用默认密码登录后必须先修改密码', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto('/login');
    await page.locator('input[name="email"]').fill('setup-admin@localhost');
    await page.locator('input[name="password"]').fill('123456');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/setup', { timeout: 15000 });

    // 改密前访问其他页面都会被送回向导
    await page.goto('/notebooks');
    await page.waitForURL('**/setup');

    // 不能把密码设回默认值
    await page.getByLabel(/^新密码$|^New password$/).fill('123456');
    await page.getByLabel(/^确认新密码$|^Confirm new password$/).fill('123456');
    await page.getByRole('button', { name: /保存新密码|Save new password/ }).click();
    await expect(page.getByText(/新密码不能是默认密码|must not be the default password/)).toBeVisible();

    await page.getByLabel(/^新密码$|^New password$/).fill('setup-new-pass');
    await page.getByLabel(/^确认新密码$|^Confirm new password$/).fill('setup-new-pass');
    await page.getByRole('button', { name: /保存新密码|Save new password/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/setup'), { timeout: 15000 });

    // 改密后可以正常访问页面
    await page.goto('/notebooks');
    await expect(page).toHaveURL(/\/notebooks/);
});

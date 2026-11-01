import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const manifestFile = process.env.E2E_RUN_FILE;
if (!manifestFile) throw new Error('请使用 npm run test:e2e，测试启动器会创建独立的应用、数据库及本地模型服务');
const run = JSON.parse(readFileSync(manifestFile, 'utf8')) as { origin: string; reportDir: string };
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(run.origin).hostname)) throw new Error('E2E 只能访问隔离的本地服务');

export default defineConfig({
    testDir: './e2e', fullyParallel: false, forbidOnly: !!process.env.CI, retries: 0, workers: 1,
    timeout: 90000, expect: { timeout: 10000 },
    outputDir: join(run.reportDir, 'artifacts'),
    reporter: [['line'], ['json', { outputFile: join(run.reportDir, 'results.json') }], ['html', { outputFolder: join(run.reportDir, 'html'), open: 'never' }]],
    use: { baseURL: run.origin, actionTimeout: 15000, navigationTimeout: 30000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
});

import { spawn, execFileSync } from 'node:child_process';
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startMockAI } from '../e2e/support/mock-ai.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-e2e-'));
const app = join(directory, 'app');
const configDir = join(directory, 'config');
const reportDir = join(directory, 'report');
mkdirSync(app);
mkdirSync(configDir);
mkdirSync(reportDir);
const children = new Set();
const stopChildren = async () => {
    for (const child of children) child.kill('SIGTERM');
    await Promise.all([...children].map((child) => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve_) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        child.once('exit', () => { clearTimeout(timer); resolve_(); });
    })));
    children.clear();
};
let interrupted = false;
const interrupt = () => { interrupted = true; for (const child of children) child.kill('SIGTERM'); };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const safeEnvironment = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'CI'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
const run = (command, arguments_, options = {}) => new Promise((resolve_, reject) => {
    if (interrupted) { reject(new Error('测试运行已中断')); return; }
    const child = spawn(command, arguments_, { cwd: app, env: environment, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    children.add(child);
    const log = createWriteStream(join(directory, options.logName || 'setup.log'), { flags: 'a', mode: 0o600 });
    child.stdout?.pipe(log, { end: false }); child.stderr?.pipe(log, { end: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => { children.delete(child); log.end(); if (code === 0) resolve_(); else reject(new Error(`命令失败：${command} ${arguments_.join(' ')}，退出 ${code ?? signal}；日志 ${directory}`)); });
});
const port = await new Promise((resolve_, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve_(value)); }); });
const mock = await startMockAI();
const origin = `http://127.0.0.1:${port}`;
const url = `file:${join(directory, 'test.db')}`;
const environment = { ...safeEnvironment, DATABASE_URL: url, CONFIG_DIR: configDir, NEXTAUTH_SECRET: 'e2e-local-only-secret-value', NEXTAUTH_URL: origin,
    APP_REVISION: `e2e-${process.pid}-${port}`, ALLOW_REGISTRATION: 'true', NEXT_TELEMETRY_DISABLED: '1', CHECKPOINT_DISABLE: '1', PORT: String(port), HOSTNAME: '127.0.0.1', NO_PROXY: '127.0.0.1,localhost,::1' };
const baseline = { aiProvider: 'openai', allowRegistration: true, aiDailyLimit: 0, aiConcurrencyLimit: 2, timeZone: 'Asia/Shanghai', setupCompletedAt: new Date().toISOString(),
    openai: { instances: [{ id: 'e2e', name: 'E2E 本地模型', apiKey: 'e2e-dummy-key', baseUrl: `${mock.origin}/cases/baseline/v1`, model: 'e2e-mock-model' }], activeInstanceId: 'e2e' },
    timeouts: { analyze: 30000 } };
await fetch(`${mock.origin}/control/baseline`, { method: 'POST', body: '{}' });
writeFileSync(join(configDir, 'app-config.json'), JSON.stringify(baseline), { mode: 0o600 });
const manifest = { directory, app, configDir, reportDir, url, origin, mockOrigin: mock.origin, baseline, networkLog: join(directory, 'network.jsonl') };
const manifestFile = join(directory, 'run.json');
writeFileSync(manifestFile, JSON.stringify(manifest), { mode: 0o600 });
process.stdout.write(`E2E 隔离目录：${directory}\n`);
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `E2E_REPORT_DIR=${reportDir}\n`);

let exitCode = 1;
let built = false;
try {
    // 仅复制应用源码与依赖，不带入本机配置、环境文件、数据库或 Git 历史。
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const name of tracked) {
        if (name.startsWith('config/') || /(^|\/)\.env(?:\.|$)/.test(name) || /\.db(?:-|$|\.)/.test(name)) continue;
        const destination = join(app, name);
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(join(root, name), destination, { mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true });
    }
    // 尚未提交的新增测试也参加类型检查；原应用配置目录始终不复制。
    cpSync(join(root, 'e2e'), join(app, 'e2e'), { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true });
    process.stdout.write('准备隔离依赖与正式迁移…\n');
    cpSync(join(root, 'node_modules'), join(app, 'node_modules'), { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true });
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'generate']);
    await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
    await run(process.execPath, [join(app, 'scripts/prepare-e2e.js')], { env: environment });
    // 从生产构建启动应用，测试专用支持代码不进入生产源码。
    const sharedCache = join(root, '.next/e2e-cache');
    if (process.env.CI && existsSync(sharedCache)) {
        mkdirSync(join(app, '.next'), { recursive: true });
        cpSync(sharedCache, join(app, '.next/cache'), { recursive: true, mode: constants.COPYFILE_FICLONE });
    }
    process.stdout.write('构建隔离应用…\n');
    // 与 npm run build 的 prebuild 一致：复制 pdfjs 的 CMap 与标准字体到 public/pdfjs
    await run(process.execPath, ['scripts/copy-pdfjs-assets.mjs']);
    await run(process.execPath, ['node_modules/next/dist/bin/next', 'build']);
    built = true;
    const server = spawn(process.execPath, ['--require', join(root, 'e2e/support/network-guard.cjs'), 'node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
        { cwd: app, env: { ...environment, E2E_ALLOWED_PORTS: `${port},${new URL(mock.origin).port}`, E2E_NETWORK_LOG: manifest.networkLog }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(server);
    const serverLog = createWriteStream(join(directory, 'server.log'), { flags: 'a', mode: 0o600 });
    server.stdout.pipe(serverLog); server.stderr.pipe(serverLog);
    const deadline = Date.now() + 90000;
    for (;;) {
        try { const response = await fetch(`${origin}/api/health`); if (response.ok) { const health = await response.json(); if (health.status === 'ok' && health.revision === environment.APP_REVISION) break; } } catch { /* 等待本次创建的服务就绪。 */ }
        if (server.exitCode !== null || Date.now() > deadline) throw new Error(`测试应用未就绪，查看 ${directory}/server.log`);
        await new Promise((resolve_) => setTimeout(resolve_, 200));
    }
    process.stdout.write(`应用及本地模型已就绪：${origin}\nE2E_RUN_FILE=${manifestFile}\n`);
    const args = process.argv.slice(2);
    if (args.includes('--serve')) await new Promise((resolve_) => { process.once('SIGINT', resolve_); process.once('SIGTERM', resolve_); });
    else await run(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), 'test', ...args], { cwd: root,
        env: { ...safeEnvironment, E2E_RUN_FILE: manifestFile }, stdio: 'inherit' });
    // 先终止本次应用，防止已取消的页面请求在审计前又创建默认错题本。
    await stopChildren();
    const requireApp = createRequire(join(app, 'package.json'));
    const { PrismaClient } = requireApp('@prisma/client');
    const database = new PrismaClient({ datasources: { db: { url } } });
    const defaults = await database.subject.deleteMany({ where: {
        user: { email: { in: ['admin@localhost', 'setup-admin@localhost'] } },
        OR: [{ name: '数学', subjectKey: 'math' }, { name: '英语', subjectKey: 'english' }],
        errorItems: { none: {} },
    } });
    writeFileSync(join(reportDir, 'default-notebooks-cleanup.json'), JSON.stringify({ removed: defaults.count }));
    const cleanup = { users: await database.user.count(), notebooks: await database.subject.count(), items: await database.errorItem.count(),
        records: await database.practiceRecord.count(), papers: await database.examPaper.count(), groups: await database.paperGroup.count(),
        privateTags: await database.knowledgeTag.count({ where: { userId: { not: null } } }) };
    await database.$disconnect();
    writeFileSync(join(reportDir, 'cleanup-audit.json'), JSON.stringify(cleanup, null, 2));
    if (cleanup.users !== 2 || Object.entries(cleanup).some(([key, count]) => key !== 'users' && count !== 0)) throw new Error(`测试结束后仍有残留学习数据：${JSON.stringify(cleanup)}`);
    const blocked = existsSync(manifest.networkLog) ? readFileSync(manifest.networkLog, 'utf8').trim() : '';
    if (blocked || mock.violations.length) throw new Error('检测到未声明的模型请求或外部网络连接');
    exitCode = 0;
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
} finally {
    writeFileSync(join(reportDir, 'model-audit.json'), JSON.stringify({ externalConnections: existsSync(manifest.networkLog) ? readFileSync(manifest.networkLog, 'utf8').trim().split('\n').filter(Boolean) : [],
        violations: mock.violations, cases: [...mock.cases.values()].map(({ held, ...state }) => ({ ...state, held: held.length })) }, null, 2));
    for (const name of ['setup.log', 'server.log']) {
        if (existsSync(join(directory, name))) cpSync(join(directory, name), join(reportDir, name));
    }
    await stopChildren();
    await mock.close();
    // 保留报告和日志，移除体积较大的隔离构建，测试临时库也随本次目录隔离。
    await new Promise((resolve_) => setTimeout(resolve_, 300));
    if (built && process.env.CI && existsSync(join(app, '.next/cache'))) {
        mkdirSync(join(root, '.next'), { recursive: true });
        cpSync(join(app, '.next/cache'), join(root, '.next/e2e-cache'), { recursive: true, mode: constants.COPYFILE_FICLONE });
    }
    rmSync(app, { recursive: true, force: true });
    process.stdout.write(`E2E 报告：${reportDir}\n`);
}
process.exitCode = exitCode;

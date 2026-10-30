/**
 * 错题本桌面壳（Electron）
 *
 *   - 启动时用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE）运行 resources/server/launcher.js，
 *     服务只监听 127.0.0.1，端口被占用时自动顺延
 *   - 数据目录为系统的应用数据目录（userData/data），卸载或升级不会删除
 *   - 全新安装还没有管理员时，直接打开一次性初始化链接设置管理员账号
 *   - 外部链接用系统浏览器打开；退出时结束服务进程
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PREFERRED_PORT = 39300;
const HOST = '127.0.0.1';

const serverRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, 'server');

let win = null;
let server = null;
let baseUrl = '';
let dataDir = '';
let quitting = false;

function findFreePort(port, attempts = 50) {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.once('error', () => {
            if (attempts <= 1) reject(new Error('没有可用端口'));
            else resolve(findFreePort(port + 1, attempts - 1));
        });
        probe.listen(port, HOST, () => probe.close(() => resolve(port)));
    });
}

async function waitForHealthy(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!server || server.exitCode !== null) throw new Error('服务进程已退出');
        try {
            const res = await fetch(`${url}/api/health`);
            if (res.ok) return;
        } catch {
            // 服务尚未监听
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('等待服务启动超时');
}

async function startServer() {
    dataDir = path.join(app.getPath('userData'), 'data');
    const logDir = path.join(dataDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'server.log');
    const log = fs.createWriteStream(logFile, { flags: 'a' });
    log.write(`\n===== ${new Date().toISOString()} v${app.getVersion()} =====\n`);

    const port = await findFreePort(PREFERRED_PORT);
    baseUrl = `http://${HOST}:${port}`;
    server = spawn(nodeExecutable(), [
        path.join(serverRoot, 'launcher.js'),
        '--port', String(port),
        '--host', HOST,
        '--data-dir', dataDir,
    ], {
        cwd: serverRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NEXTAUTH_URL: baseUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    server.stdout.pipe(log);
    server.stderr.pipe(log);
    server.on('exit', (code) => {
        log.write(`[desktop] 服务进程退出，退出码 ${code}\n`);
        if (!quitting) {
            dialog.showErrorBox('错题本服务已停止', `服务进程意外退出（退出码 ${code}）。\n日志：${logFile}`);
            app.quit();
        }
    });

    try {
        await waitForHealthy(baseUrl, 180_000);
    } catch (error) {
        throw new Error(`${error.message}\n日志：${logFile}`);
    }
}

/** macOS 上用主程序跑 Node 会在程序坞多出一个图标，改用不显示图标的 Helper 程序 */
function nodeExecutable() {
    if (process.platform !== 'darwin' || !app.isPackaged) return process.execPath;
    const name = `${path.basename(process.execPath)} Helper`;
    const helper = path.join(path.dirname(process.execPath), '..', 'Frameworks', `${name}.app`, 'Contents', 'MacOS', name);
    return fs.existsSync(helper) ? helper : process.execPath;
}

/**
 * 启动后打开的地址：服务端在全新安装（还没有管理员）时把一次性初始化令牌写到配置目录，
 * 有令牌就直接打开初始化页；创建管理员后令牌被删除，之后打开首页
 */
function startUrl() {
    let token = '';
    try {
        token = fs.readFileSync(path.join(dataDir, 'config', 'setup-token'), 'utf8').trim();
    } catch {
        // 没有令牌：已经创建过管理员
    }
    return /^[\w-]{16,128}$/.test(token) ? `${baseUrl}/initialize?token=${token}` : baseUrl;
}

function stopServer() {
    if (server && server.exitCode === null) server.kill();
}

const LOADING_HTML = `<!doctype html><meta charset="utf-8"><title>错题本</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;color:#555;background:#fafafa}
@media(prefers-color-scheme:dark){body{background:#1f1f1f;color:#ccc}}</style>
<p>错题本正在启动，首次运行需要初始化数据库，请稍候…</p>`;

function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 360,
        minHeight: 560,
        title: '错题本',
        icon: path.join(__dirname, 'icon.png'),
        autoHideMenuBar: true,
        show: false,
        webPreferences: { contextIsolation: true, sandbox: true },
    });
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => { win = null; });
    // 站内链接留在窗口内，其他链接交给系统浏览器
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (baseUrl && url.startsWith(baseUrl)) return { action: 'allow' };
        shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith('data:') || (baseUrl && url.startsWith(baseUrl))) return;
        event.preventDefault();
        shell.openExternal(url);
    });
    if (baseUrl) win.loadURL(baseUrl);
    else win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`);
}

async function boot() {
    // macOS 保留默认菜单以支持复制粘贴等快捷键；其他平台隐藏菜单栏
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    createWindow();
    try {
        await startServer();
    } catch (error) {
        dialog.showErrorBox('错题本启动失败', String(error.message || error));
        quitting = true;
        stopServer();
        app.quit();
        return;
    }
    if (win) win.loadURL(startUrl());
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!win) createWindow();
        else {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });
    app.whenReady().then(boot);
    app.on('activate', () => {
        if (!win && baseUrl) createWindow();
    });
    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
    app.on('before-quit', () => {
        quitting = true;
        stopServer();
    });
}

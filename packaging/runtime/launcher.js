#!/usr/bin/env node
/**
 * wrong-notebook 安装包通用启动器（npm、桌面端、飞牛OS 共用）
 *
 * 与 docker-entrypoint.sh 的行为保持一致：
 *   1. 准备数据目录：数据库、配置文件、NextAuth 密钥都放在数据目录，安装目录可以只读
 *   2. 首次运行时复制打包时预置的数据库（含系统标签，不含管理员；服务启动后在日志中打印一次性初始化链接）
 *   3. 每次启动执行 prisma migrate deploy，只做增量迁移，保留已有数据
 *   4. 在当前进程内启动 Next.js standalone 服务
 *
 * 用法：node launcher.js [--port 3000] [--host 0.0.0.0] [--data-dir 目录]
 * 也可用环境变量 PORT、HOSTNAME、WRONG_NOTEBOOK_HOME 指定。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const APP_DIR = __dirname;
const DEFAULT_PORT = 3000;

function parseArgs(argv) {
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const [key, inline] = arg.split('=', 2);
        const next = () => (inline !== undefined ? inline : argv[++i]);
        if (key === '--port' || key === '-p') opts.port = next();
        else if (key === '--host' || key === '-H') opts.host = next();
        else if (key === '--data-dir' || key === '-d') opts.dataDir = next();
    }
    return opts;
}

function defaultDataDir() {
    if (process.env.WRONG_NOTEBOOK_HOME) return process.env.WRONG_NOTEBOOK_HOME;
    return path.join(os.homedir(), '.wrong-notebook');
}

function appVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version || 'unknown';
    } catch {
        return 'unknown';
    }
}

/** NextAuth 会话密钥：首次运行随机生成并保存，之后保持不变，避免重启后登录失效 */
function ensureSecret(dataDir) {
    const file = path.join(dataDir, '.nextauth_secret');
    const saved = readTextIfExists(file).trim();
    if (saved) return saved;
    const secret = crypto.randomBytes(32).toString('base64');
    try {
        // wx：文件已存在时失败，不覆盖同时启动的另一个进程刚生成的密钥
        fs.writeFileSync(file, secret, { mode: 0o600, flag: 'wx' });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const other = readTextIfExists(file).trim();
        if (other) return other;
        // 已有的是空文件，直接覆盖
        fs.writeFileSync(file, secret, { mode: 0o600 });
    }
    return secret;
}

function readTextIfExists(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return '';
        throw error;
    }
}

/** Prisma 的 SQLite 地址统一使用正斜杠，Windows 盘符路径也可用 */
function sqliteUrl(file) {
    return `file:${file.split(path.sep).join('/')}`;
}

function runPrisma(args, env) {
    const cli = require.resolve('prisma/build/index.js', { paths: [APP_DIR] });
    const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: APP_DIR,
        env,
        stdio: 'inherit',
        windowsHide: true,
    });
    if (result.error) throw result.error;
    return result.status === 0;
}

/** npm 安装时 Prisma Client 由 postinstall 生成；被 --ignore-scripts 跳过时在这里补生成 */
function ensurePrismaClient(env) {
    let clientDir;
    try {
        clientDir = path.dirname(require.resolve('.prisma/client/index.js', { paths: [APP_DIR] }));
    } catch {
        clientDir = null;
    }
    if (clientDir && fs.existsSync(path.join(clientDir, 'schema.prisma'))) return;
    console.log('[wrong-notebook] 正在生成 Prisma Client...');
    if (!runPrisma(['generate', '--schema', path.join(APP_DIR, 'prisma', 'schema.prisma')], env)) {
        throw new Error('Prisma Client 生成失败，请检查安装目录是否可写');
    }
}

/**
 * Turbopack 把 serverExternalPackages 编译成带哈希的别名（如 @prisma/client-2c3a283f134fdcb6），
 * standalone 用 .next/node_modules 下的符号链接指向真实包。npm 打包会丢弃该目录，
 * 飞牛OS 打包也不接受符号链接，因此安装包不带这些链接，改为在解析失败时去掉哈希后缀再解析。
 */
function installExternalAliasResolver() {
    const Module = require('node:module');
    if (typeof Module.registerHooks !== 'function') {
        throw new Error(`需要 Node.js 22.15 或更高版本（当前 ${process.version}）`);
    }
    const alias = /^((?:@[^/]+\/)?[^/]+)-[0-9a-f]{16}(\/.*)?$/;
    // 同时作用于 require 和 import（bcryptjs 3 为 ESM，由 import() 加载）
    Module.registerHooks({
        resolve(specifier, context, nextResolve) {
            try {
                return nextResolve(specifier, context);
            } catch (error) {
                const match = alias.exec(specifier);
                if (!match) throw error;
                return nextResolve(match[1] + (match[2] || ''), context);
            }
        },
    });
}

/**
 * 安装包只保留 .prisma/client 里的一份查询引擎，让 Prisma CLI 也使用它，避免运行迁移时联网下载
 */
function useBundledQueryEngine(env) {
    if (env.PRISMA_QUERY_ENGINE_LIBRARY) return;
    try {
        const clientDir = path.dirname(require.resolve('.prisma/client/index.js', { paths: [APP_DIR] }));
        const engine = fs.readdirSync(clientDir).find((name) => /^(lib)?query_engine-.*\.node$/.test(name));
        if (engine) env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(clientDir, engine);
    } catch {
        // npm 安装且尚未生成 Prisma Client 时交给 Prisma 自行查找
    }
}

function prepare(options = {}) {
    const dataDir = path.resolve(options.dataDir || defaultDataDir());
    const configDir = path.join(dataDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });

    const dbFile = path.join(dataDir, 'wrong-notebook.db');
    const version = appVersion();
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        DATABASE_URL: sqliteUrl(dbFile),
        CONFIG_DIR: configDir,
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || ensureSecret(dataDir),
        AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST || 'true',
        PRESERVE_EXISTING_DATA: 'true',
        PRISMA_HIDE_UPDATE_MESSAGE: 'true',
        APP_VERSION: process.env.APP_VERSION || version,
        WRONG_NOTEBOOK_HOME: dataDir,
    };

    ensurePrismaClient(env);
    useBundledQueryEngine(env);

    if (!fs.existsSync(dbFile) || fs.statSync(dbFile).size === 0) {
        const seed = path.join(APP_DIR, 'prisma', 'seed.db');
        if (fs.existsSync(seed)) {
            console.log('[wrong-notebook] 初始化数据库（首次访问需用启动日志中的初始化链接创建管理员）');
            fs.copyFileSync(seed, dbFile);
        }
    }

    console.log('[wrong-notebook] 正在执行数据库迁移...');
    if (!runPrisma(['migrate', 'deploy', '--schema', path.join(APP_DIR, 'prisma', 'schema.prisma')], env)) {
        throw new Error('数据库迁移失败，已停止启动');
    }
    return { dataDir, dbFile, env, version };
}

function start(options = {}) {
    const { dataDir, env, version } = prepare(options);
    const port = String(options.port || process.env.PORT || DEFAULT_PORT);
    const host = options.host || process.env.HOSTNAME || '0.0.0.0';
    Object.assign(process.env, env, { PORT: port, HOSTNAME: host });
    console.log(`[wrong-notebook] v${version} 数据目录：${dataDir}`);
    const shownHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    console.log(`[wrong-notebook] 访问地址：http://${shownHost}:${port}`);
    installExternalAliasResolver();
    // standalone 的 server.js 会切换工作目录到自身所在目录并监听 PORT/HOSTNAME
    require(path.join(APP_DIR, 'server.js'));
}

module.exports = { prepare, start, parseArgs, defaultDataDir, sqliteUrl, ensureSecret };

if (require.main === module) {
    try {
        start(parseArgs(process.argv.slice(2)));
    } catch (error) {
        console.error(`[wrong-notebook] 启动失败：${error.message}`);
        process.exit(1);
    }
}

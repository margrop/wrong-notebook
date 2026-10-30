#!/usr/bin/env node
/**
 * 全平台安装包构建脚本
 *
 *   node scripts/package/build.mjs bundle [--skip-build]   构建通用服务端包 dist/bundle
 *   node scripts/package/build.mjs npm                     生成 npm 包目录 dist/npm 并 npm pack
 *   node scripts/package/build.mjs desktop [electron-builder 参数...]
 *                                                          打包 Windows / macOS / Linux 桌面安装包
 *   node scripts/package/build.mjs fnos --arch x86|arm     打包飞牛OS fpk（需要 fnpack）
 *   node scripts/package/build.mjs android [--mode standalone|client] [--flavor phone|tablet]
 *                                                          打包安卓 APK（需要 Android SDK 和 Gradle）：单机版内置服务端，
 *                                                          需先构建 dist/bundle 和安卓 Prisma 引擎；客户端版连接已部署的服务器
 *
 * 版本号依次取 --version、环境变量 PACKAGE_VERSION、package.json。
 * Prisma 引擎与当前构建机平台一致，因此桌面端和飞牛OS 需在目标平台上构建（见 .github/workflows/packages.yml）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAndroidRuntime } from './android-runtime.mjs';
import { androidVersionCode } from './android-version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const BUNDLE = path.join(DIST, 'bundle');
const WORK = path.join(DIST, '.work');
const PACKAGING = path.join(ROOT, 'packaging');
const rootPkg = readJson(path.join(ROOT, 'package.json'));

const [command, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
const version = String(flags.version || process.env.PACKAGE_VERSION || rootPkg.version).replace(/^v/, '');

function parseFlags(args) {
    const out = { _: [] };
    for (let i = 0; i < args.length; i++) {
        const m = /^--(version|arch|flavor|mode)(?:=(.*))?$/.exec(args[i]);
        if (m) out[m[1]] = m[2] ?? args[++i];
        else if (args[i] === '--skip-build') out.skipBuild = true;
        else out._.push(args[i]);
    }
    return out;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function log(message) {
    console.log(`\n[package] ${message}`);
}

function run(cmd, args, options = {}) {
    const result = spawnSync(cmd, args, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32' && !path.isAbsolute(cmd),
        ...options,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...options.env },
    });
    if (result.status !== 0) {
        throw new Error(`命令失败（退出码 ${result.status}）：${cmd} ${args.join(' ')}`);
    }
}

/** 用当前 Node 运行仓库内依赖的 CLI，避免 Windows 下 npx 的引号问题 */
function runNodeBin(relPath, args, options) {
    run(process.execPath, [path.join(ROOT, 'node_modules', relPath), ...args], options);
}

function copy(src, dest) {
    fs.cpSync(src, dest, {
        recursive: true,
        force: true,
        verbatimSymlinks: true,
        filter: (file) => path.basename(file) !== '.bin',
    });
}

function rm(target) {
    fs.rmSync(target, { recursive: true, force: true });
}

/** 预置数据库：执行全部迁移并写入系统标签（不含管理员，首次启动用初始化链接创建），与 Docker 镜像内的 prisma/dev.db 一致 */
function buildSeedDatabase() {
    log('构建预置数据库');
    const seedDb = path.join(WORK, 'seed.db');
    const scriptsOut = path.join(WORK, 'dist-scripts');
    const env = { DATABASE_URL: `file:${seedDb.split(path.sep).join('/')}` };
    runNodeBin('typescript/bin/tsc', [
        'scripts/rebuild-system-tags.ts', '--outDir', scriptsOut,
        '--esModuleInterop', '--resolveJsonModule', '--skipLibCheck', '--module', 'commonjs', '--target', 'ES2020',
    ]);
    runNodeBin('prisma/build/index.js', ['migrate', 'deploy'], { env });
    run(process.execPath, ['scripts/seed-admin.js'], { env });
    run(process.execPath, [path.join(scriptsOut, 'scripts', 'rebuild-system-tags.js')], { env });
    return seedDb;
}

/** standalone 只追踪运行时用到的依赖；npm 包据此声明依赖，版本固定为构建时安装的版本 */
function collectRuntimeDependencies(nodeModules) {
    const declared = { ...rootPkg.devDependencies, ...rootPkg.dependencies };
    const names = [];
    for (const entry of fs.readdirSync(nodeModules)) {
        if (entry.startsWith('.')) continue;
        if (entry.startsWith('@')) {
            for (const sub of fs.readdirSync(path.join(nodeModules, entry))) names.push(`${entry}/${sub}`);
        } else {
            names.push(entry);
        }
    }
    // 未在 package.json 声明、也不是其他已追踪包依赖的包（如 google-auth-library）同样需要声明；
    // @img/* 是 sharp 的平台二进制，交给 npm 按用户平台安装
    const manifests = Object.fromEntries(names.map((n) => [n, readJson(path.join(ROOT, 'node_modules', n, 'package.json'))]));
    const covered = new Set();
    for (const manifest of Object.values(manifests)) {
        for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
            for (const dep of Object.keys(manifest[field] || {})) covered.add(dep);
        }
    }
    const deps = {};
    for (const name of names.sort()) {
        if (name.startsWith('@img/')) continue;
        if (declared[name] || !covered.has(name)) deps[name] = manifests[name].version;
    }
    deps.prisma = readJson(path.join(ROOT, 'node_modules', 'prisma', 'package.json')).version;
    return deps;
}

/**
 * 精简 Prisma 相关文件，缩小桌面版和飞牛OS 安装包：
 *   - 查询引擎只保留本平台的一份（.prisma/client 内），删除其他平台和重复的副本
 *   - 删除 Prisma Client 中只用于 Edge / WebAssembly / React Native 的运行时
 * 迁移只需 schema 引擎；Prisma CLI 用到查询引擎时由 launcher.js 通过 PRISMA_QUERY_ENGINE_LIBRARY 指向保留的那一份
 */
function pruneBundle() {
    const nodeModules = path.join(BUNDLE, 'node_modules');
    const isQueryEngine = (name) => /^(lib)?query_engine[-_.]/.test(name);
    const native = fs.readdirSync(path.join(ROOT, 'node_modules', '@prisma', 'engines')).find(isQueryEngine);
    if (!native) throw new Error('未找到本平台的 Prisma 查询引擎');
    const before = dirSize(nodeModules);

    const clientDir = path.join(nodeModules, '.prisma', 'client');
    for (const name of fs.readdirSync(clientDir)) {
        if ((isQueryEngine(name) && name !== native) || name.startsWith('query_engine_bg.')) rm(path.join(clientDir, name));
    }
    for (const dir of [path.join(nodeModules, 'prisma'), path.join(nodeModules, '@prisma', 'engines')]) {
        for (const name of fs.readdirSync(dir)) if (isQueryEngine(name)) rm(path.join(dir, name));
    }
    const runtimeDir = path.join(nodeModules, '@prisma', 'client', 'runtime');
    for (const name of fs.readdirSync(runtimeDir)) {
        if (/\.wasm$|^(edge|edge-esm|wasm|react-native)\.(js|d\.ts)$/.test(name)) rm(path.join(runtimeDir, name));
    }
    for (const pkg of ['adapter-libsql', 'driver-adapter-utils']) rm(path.join(nodeModules, '@prisma', pkg));

    if (!fs.existsSync(path.join(clientDir, native))) throw new Error(`.prisma/client 中缺少本平台查询引擎 ${native}`);
    const mb = (bytes) => `${(bytes / 1048576).toFixed(0)}MB`;
    log(`精简 node_modules：${mb(before)} → ${mb(dirSize(nodeModules))}`);
}

function dirSize(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += dirSize(full);
        else if (entry.isFile()) total += fs.statSync(full).size;
    }
    return total;
}

function buildBundle() {
    rm(WORK);
    fs.mkdirSync(WORK, { recursive: true });
    log('生成 Prisma Client');
    runNodeBin('prisma/build/index.js', ['generate']);
    const seedDb = buildSeedDatabase();

    if (!flags.skipBuild) {
        log('构建 Next.js 应用');
        runNodeBin('next/dist/bin/next', ['build']);
    }
    const standalone = path.join(ROOT, '.next', 'standalone');
    if (!fs.existsSync(path.join(standalone, 'server.js'))) {
        throw new Error('未找到 .next/standalone/server.js，请先执行 npm run build');
    }

    log('组装 dist/bundle');
    rm(BUNDLE);
    copy(standalone, BUNDLE);
    // standalone 可能带入本机的 .env、配置文件和数据库，全部移除，避免把密钥打进安装包
    for (const entry of fs.readdirSync(BUNDLE)) {
        if (entry.startsWith('.env') || /\.(db|db-journal|sqlite)$/.test(entry)) rm(path.join(BUNDLE, entry));
    }
    for (const dir of ['config', 'data', 'prisma', 'certs', 'dist-scripts']) rm(path.join(BUNDLE, dir));
    // 外部包别名链接由 launcher.js 在运行时解析（见 installExternalAliasResolver）
    rm(path.join(BUNDLE, '.next', 'node_modules'));

    // npm 包需要的依赖列表，在覆盖 Prisma 目录之前按 standalone 追踪结果计算
    const runtimeDeps = collectRuntimeDependencies(path.join(BUNDLE, 'node_modules'));
    writeJson(path.join(WORK, 'runtime-dependencies.json'), runtimeDeps);

    copy(path.join(ROOT, '.next', 'static'), path.join(BUNDLE, '.next', 'static'));
    copy(path.join(ROOT, 'public'), path.join(BUNDLE, 'public'));
    fs.mkdirSync(path.join(BUNDLE, 'prisma'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), path.join(BUNDLE, 'prisma', 'schema.prisma'));
    copy(path.join(ROOT, 'prisma', 'migrations'), path.join(BUNDLE, 'prisma', 'migrations'));
    fs.copyFileSync(seedDb, path.join(BUNDLE, 'prisma', 'seed.db'));
    // 运行时迁移需要 Prisma CLI 和本平台的 schema 引擎（与 Dockerfile 一致）
    for (const dir of ['.prisma', 'prisma', '@prisma']) {
        copy(path.join(ROOT, 'node_modules', dir), path.join(BUNDLE, 'node_modules', dir));
    }
    pruneBundle();
    fs.copyFileSync(path.join(PACKAGING, 'runtime', 'launcher.js'), path.join(BUNDLE, 'launcher.js'));
    // MIT 许可证要求随软件分发许可证文本，npm、桌面版和飞牛OS 安装包都基于此目录
    fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(BUNDLE, 'LICENSE'));

    const pkg = readJson(path.join(BUNDLE, 'package.json'));
    writeJson(path.join(BUNDLE, 'package.json'), {
        name: pkg.name,
        version,
        private: true,
        description: '错题本服务端（安装包运行时）',
    });
    log(`dist/bundle 已就绪（v${version}）：${fs.readdirSync(BUNDLE).join(', ')}`);
}

function requireBundle() {
    if (!fs.existsSync(path.join(BUNDLE, 'launcher.js'))) {
        throw new Error('未找到 dist/bundle，请先执行 node scripts/package/build.mjs bundle');
    }
}

function buildNpm() {
    requireBundle();
    const out = path.join(DIST, 'npm');
    rm(out);
    fs.mkdirSync(out, { recursive: true });
    log('组装 npm 包');
    for (const entry of fs.readdirSync(BUNDLE)) {
        if (entry === 'node_modules' || entry === 'package.json') continue;
        copy(path.join(BUNDLE, entry), path.join(out, entry));
    }
    copy(path.join(PACKAGING, 'npm', 'bin'), path.join(out, 'bin'));
    fs.copyFileSync(path.join(PACKAGING, 'npm', 'README.md'), path.join(out, 'README.md'));
    // npm 安装时按用户平台生成 Prisma Client，只需本机引擎
    const schemaFile = path.join(out, 'prisma', 'schema.prisma');
    fs.writeFileSync(schemaFile, fs.readFileSync(schemaFile, 'utf8').replace(/^\s*binaryTargets\s*=.*\n/m, ''));

    writeJson(path.join(out, 'package.json'), {
        name: 'wrong-notebook',
        version,
        description: '错题本：上传题目图片，由 AI 识别、解析并标注知识点，支持练习、统计与打印导出',
        keywords: ['wrong-notebook', 'mistake-notebook', '错题本', 'ai', 'education'],
        homepage: 'https://github.com/margrop/wrong-notebook',
        repository: { type: 'git', url: 'git+https://github.com/margrop/wrong-notebook.git' },
        bugs: 'https://github.com/margrop/wrong-notebook/issues',
        license: 'MIT',
        bin: { 'wrong-notebook': 'bin/wrong-notebook.js' },
        files: ['bin', 'launcher.js', 'server.js', '.next', 'public', 'prisma', 'README.md', 'LICENSE'],
        engines: { node: '>=22.15' },
        scripts: { postinstall: 'node bin/wrong-notebook.js prepare-client' },
        dependencies: readJson(path.join(WORK, 'runtime-dependencies.json')),
    });
    run('npm', ['pack', '--pack-destination', DIST], { cwd: out });
    log(`npm 包已生成：dist/wrong-notebook-${version}.tgz`);
}

function buildDesktop() {
    requireBundle();
    const stage = path.join(DIST, 'desktop');
    rm(stage);
    log('准备桌面端工程');
    copy(path.join(PACKAGING, 'desktop'), stage);
    copy(BUNDLE, path.join(stage, 'server'));
    fs.copyFileSync(path.join(ROOT, 'public', 'icons', 'icon.png'), path.join(stage, 'icon.png'));
    run('npm', ['install', '--no-audit', '--no-fund'], { cwd: stage });
    log('electron-builder 打包');
    run('npx', ['electron-builder', '--publish', 'never', `-c.extraMetadata.version=${version}`, ...flags._], { cwd: stage });
    verifyDesktopOutput(path.join(stage, 'release'));
}

/** electron-builder 的文件过滤规则较多，打包后确认服务端关键文件确实进入安装包 */
function verifyDesktopOutput(releaseDir) {
    const required = ['launcher.js', 'server.js', '.next/BUILD_ID', 'node_modules/.prisma/client/index.js', 'prisma/seed.db'];
    const roots = [];
    const walk = (dir, depth) => {
        if (depth > 6 || !fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const full = path.join(dir, entry.name);
            if (entry.name === 'server' && /^resources$/i.test(path.basename(dir))) {
                roots.push(full);
            } else {
                walk(full, depth + 1);
            }
        }
    };
    walk(releaseDir, 0);
    if (roots.length === 0) {
        log('未找到解包目录，跳过安装包内容检查');
        return;
    }
    for (const root of roots) {
        const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
        if (missing.length > 0) throw new Error(`${root} 缺少文件：${missing.join(', ')}`);
    }
    log(`安装包内容检查通过：${roots.map((r) => path.relative(ROOT, r)).join(', ')}`);
}

function buildFnos() {
    requireBundle();
    const arch = flags.arch || (process.arch === 'arm64' ? 'arm' : 'x86');
    if (!['x86', 'arm'].includes(arch)) throw new Error('--arch 只能是 x86 或 arm');
    const stage = path.join(DIST, 'fnos');
    rm(stage);
    log(`准备飞牛OS 打包目录（${arch}）`);
    copy(path.join(PACKAGING, 'fnos'), stage);
    copy(BUNDLE, path.join(stage, 'app', 'server'));
    const manifestFile = path.join(stage, 'manifest');
    fs.writeFileSync(manifestFile, fs.readFileSync(manifestFile, 'utf8')
        .replace(/^version\s*=.*$/m, `version               = ${version}`)
        .replace(/^platform\s*=.*$/m, `platform              = ${arch}`));
    // fnpack 不接受符号链接
    const dropLinks = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) rm(full);
            else if (entry.isDirectory()) dropLinks(full);
        }
    };
    dropLinks(stage);
    for (const file of fs.readdirSync(path.join(stage, 'cmd'))) fs.chmodSync(path.join(stage, 'cmd', file), 0o755);

    const probe = spawnSync('fnpack', ['--help'], { stdio: 'ignore' });
    if (probe.error) {
        log('未找到 fnpack，已生成打包目录 dist/fnos；在飞牛OS 或 Linux 上执行 fnpack build -d dist/fnos 即可');
        return;
    }
    rm(path.join(stage, 'wrongnotebook.fpk'));
    run('fnpack', ['build', '-d', '.'], { cwd: stage });
    const out = path.join(DIST, `WrongNotebook-FnOS-${version}-${arch}.fpk`);
    fs.renameSync(path.join(stage, 'wrongnotebook.fpk'), out);
    log(`飞牛OS 安装包已生成：${path.relative(ROOT, out)}`);
}

/**
 * 安卓 APK 有两种模式，各分手机版（竖屏）和平板版（横竖屏）：
 *   - standalone 单机版：内置 Node.js、Prisma 引擎和 dist/bundle，在手机上运行完整服务端，数据保存在本机
 *   - client 客户端版：只是连接已部署服务器的 WebView 外壳
 * 单机版的 Prisma 引擎目录取 ANDROID_PRISMA_ENGINES_DIR，默认 dist/android-prisma-engines
 * （由 build-android-prisma-engines.sh 生成）；patchelf 可用 PATCHELF 指定路径。
 * 签名密钥通过环境变量 ANDROID_KEYSTORE_FILE 等传入（见 packaging/android/app/build.gradle），未提供时使用调试签名。
 */
async function buildAndroid() {
    const modes = flags.mode ? [flags.mode] : ['standalone', 'client'];
    const flavors = flags.flavor ? [flags.flavor] : ['phone', 'tablet'];
    if (modes.some((mode) => !['standalone', 'client'].includes(mode))) throw new Error('--mode 只能是 standalone 或 client');
    if (flavors.some((flavor) => !['phone', 'tablet'].includes(flavor))) throw new Error('--flavor 只能是 phone 或 tablet');
    if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
        throw new Error('未设置 ANDROID_HOME，请安装 Android SDK（compileSdk 35）');
    }
    const project = path.join(PACKAGING, 'android');
    const runtimeDir = path.join(DIST, 'android-runtime');
    if (modes.includes('standalone')) {
        requireBundle();
        log('组装安卓单机版运行时');
        await buildAndroidRuntime({
            bundleDir: BUNDLE,
            enginesDir: path.resolve(process.env.ANDROID_PRISMA_ENGINES_DIR || path.join(DIST, 'android-prisma-engines')),
            outDir: runtimeDir,
            workDir: path.join(WORK, 'android-runtime'),
            version,
            log,
        });
    }

    const versionCode = androidVersionCode(version);
    const capitalize = (s) => s[0].toUpperCase() + s.slice(1);
    const variants = modes.flatMap((mode) => flavors.map((flavor) => ({ mode, flavor, name: `${mode}${capitalize(flavor)}` })));
    log(`构建安卓 APK（${variants.map((v) => v.name).join('、')}，v${version}，versionCode ${versionCode}）`);
    run(process.env.GRADLE || 'gradle', [
        '-p', project, '--no-daemon',
        ...variants.map((v) => `:app:assemble${capitalize(v.name)}Release`),
        `-PappVersionName=${version}`,
        `-PappVersionCode=${versionCode}`,
        `-PstandaloneRuntimeDir=${runtimeDir}`,
    ]);
    fs.mkdirSync(DIST, { recursive: true });
    for (const { mode, flavor, name } of variants) {
        const apk = path.join(project, 'app', 'build', 'outputs', 'apk', name, 'release', `app-${mode}-${flavor}-release.apk`);
        if (!fs.existsSync(apk)) throw new Error(`未找到 ${path.relative(ROOT, apk)}`);
        const prefix = mode === 'client' ? 'WrongNotebook-Android-Client' : 'WrongNotebook-Android';
        const out = path.join(DIST, `${prefix}-${capitalize(flavor)}-${version}.apk`);
        fs.copyFileSync(apk, out);
        log(`安卓安装包已生成：${path.relative(ROOT, out)}`);
    }
}

const commands = { bundle: buildBundle, npm: buildNpm, desktop: buildDesktop, fnos: buildFnos, android: buildAndroid };
if (!commands[command]) {
    console.error('用法：node scripts/package/build.mjs <bundle|npm|desktop|fnos|android> [参数]');
    process.exit(1);
}
try {
    await commands[command]();
} catch (error) {
    console.error(`\n[package] ${error.message}`);
    process.exit(1);
}

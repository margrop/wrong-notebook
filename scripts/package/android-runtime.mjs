/**
 * 安卓单机版运行时：在 APK 中内置 Node.js、Prisma 引擎和服务端，手机上无需另行部署服务器。
 *
 * - Node.js 使用 Termux 为安卓编译的 nodejs（当前 26.x，依赖 libicu 79）及其依赖库（按软件源索引中的 SHA256 校验）；
 *   nodejs-lts 24.22.2 仍依赖 libicui18n.so.78，而软件源的 libicu 已更新到 79.1，两者不兼容，暂不采用。
 * - Prisma 引擎由 build-android-prisma-engines.sh 交叉编译
 * - 可执行文件和动态库都放进 jniLibs/arm64-v8a，安装时解压到应用的 nativeLibraryDir，
 *   这是 Android 10 及以上唯一允许应用执行自带程序的位置；jniLibs 只打包 lib*.so，
 *   因此按 androidLibraryName() 改名，并用 patchelf 同步改写 SONAME 和依赖项
 * - 服务端（dist/bundle）打成 assets/server.zip，首次启动时由应用解压
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const TERMUX_ARCH = 'aarch64';
export const ANDROID_ABI = 'arm64-v8a';
export const NODE_PACKAGE = 'nodejs';
const DEFAULT_TERMUX_MIRROR = 'https://packages.termux.dev/apt/termux-main';
/** 安卓系统自带、无需打包的库 */
const SYSTEM_LIBRARIES = new Set(['libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so']);


/** 拆分 Debian 版本号（epoch:upstream-revision） */
function splitDebianVersion(value) {
    const colon = value.indexOf(':');
    const epoch = colon >= 0 ? Number(value.slice(0, colon)) : 0;
    const rest = colon >= 0 ? value.slice(colon + 1) : value;
    const dash = rest.lastIndexOf('-');
    return [epoch, dash >= 0 ? rest.slice(0, dash) : rest, dash >= 0 ? rest.slice(dash + 1) : ''];
}

/** 按数字段/非数字段交替比较版本片段（Termux 的包版本以数字和 . - 为主） */
function compareVersionPart(left, right) {
    const leftTokens = left.match(/\d+|[^\d]+/g) ?? [];
    const rightTokens = right.match(/\d+|[^\d]+/g) ?? [];
    for (let i = 0; i < Math.max(leftTokens.length, rightTokens.length); i++) {
        const a = leftTokens[i];
        const b = rightTokens[i];
        if (a === undefined) return b === undefined ? 0 : -1;
        if (b === undefined) return 1;
        const bothNumeric = /^\d+$/.test(a) && /^\d+$/.test(b);
        if (bothNumeric) {
            // 避免超大版本号转 Number 丢精度：先比长度，再按字符串比较
            if (a.length !== b.length) return a.length < b.length ? -1 : 1;
            if (a !== b) return a < b ? -1 : 1;
        } else if (a !== b) {
            return a < b ? -1 : 1;
        }
    }
    return 0;
}

/** 比较 Debian 版本号；相同时返回 0，left 较新时返回正数 */
export function compareDebianVersions(left, right) {
    const [leftEpoch, leftUpstream, leftRevision] = splitDebianVersion(left);
    const [rightEpoch, rightUpstream, rightRevision] = splitDebianVersion(right);
    if (leftEpoch !== rightEpoch) return leftEpoch > rightEpoch ? 1 : -1;
    const upstream = compareVersionPart(leftUpstream, rightUpstream);
    if (upstream !== 0) return upstream;
    return compareVersionPart(leftRevision, rightRevision);
}
/** 解析 apt 软件源的 Packages 索引 */
export function parseTermuxPackages(text) {
    const index = new Map();
    for (const block of text.split(/\n\s*\n/)) {
        const fields = {};
        let last = null;
        for (const line of block.split('\n')) {
            if (/^\s/.test(line) && last) {
                fields[last] += `\n${line.trim()}`;
            } else {
                const m = /^([\w-]+):\s*(.*)$/.exec(line);
                if (m) {
                    last = m[1];
                    fields[last] = m[2];
                }
            }
        }
        if (fields.Package) {
            // 同一包可能同时列出基础版本与修订版本（如 nodejs 26.13.0 / 26.13.0-1），取最新
            const existing = index.get(fields.Package);
            if (!existing || compareDebianVersions(fields.Version, existing.Version) > 0) index.set(fields.Package, fields);
        }
    }
    return index;
}

/** 递归解析依赖（忽略版本约束和可选依赖），返回按名称排序的软件包 */
export function resolveTermuxDependencies(index, name) {
    const seen = new Map();
    const visit = (pkg) => {
        if (seen.has(pkg)) return;
        const entry = index.get(pkg);
        if (!entry) throw new Error(`Termux 软件源中没有 ${pkg}`);
        seen.set(pkg, entry);
        for (const dep of (entry.Depends || '').split(',')) {
            // "a | b" 取第一个，"pkg (>= 1.0)" 去掉版本约束
            const depName = dep.split('|')[0].trim().split(/\s+/)[0];
            if (depName) visit(depName);
        }
    };
    visit(name);
    return [...seen.values()].sort((a, b) => a.Package.localeCompare(b.Package));
}

/** 把带版本后缀的库名改成 jniLibs 可打包的 lib*.so，如 libz.so.1 → libz1.so */
export function androidLibraryName(soname) {
    if (/^lib.+\.so$/.test(soname)) return soname;
    const m = /^(lib.+)\.so\.([\d.]+)$/.exec(soname);
    if (!m) throw new Error(`无法识别的库名 ${soname}`);
    return `${m[1]}${m[2].replace(/\./g, '_')}.so`;
}

/** 解析 deb（ar 归档），返回其中 data.tar.* 的文件名和内容 */
export function extractDebData(buffer) {
    if (buffer.subarray(0, 8).toString('latin1') !== '!<arch>\n') throw new Error('不是有效的 deb 文件');
    let offset = 8;
    while (offset + 60 <= buffer.length) {
        const name = buffer.subarray(offset, offset + 16).toString('latin1').trim().replace(/\/$/, '');
        const size = Number.parseInt(buffer.subarray(offset + 48, offset + 58).toString('latin1').trim(), 10);
        const start = offset + 60;
        if (name.startsWith('data.tar')) return { name, data: buffer.subarray(start, start + size) };
        offset = start + size + (size % 2);
    }
    throw new Error('deb 中缺少 data.tar');
}

function run(cmd, args, options = {}) {
    const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`命令失败（退出码 ${result.status}）：${cmd} ${args.join(' ')}\n${result.stderr || ''}`);
    }
    return result.stdout;
}

async function download(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）：${url}`);
    return Buffer.from(await response.arrayBuffer());
}

/** 下载 nodejs 及依赖并解包到 workDir/termux，返回 Termux 前缀目录和软件包版本 */
async function fetchTermuxNode(workDir, log) {
    const mirror = (process.env.TERMUX_MIRROR || DEFAULT_TERMUX_MIRROR).replace(/\/$/, '');
    const index = parseTermuxPackages((await download(`${mirror}/dists/stable/main/binary-${TERMUX_ARCH}/Packages`)).toString('utf8'));
    const packages = resolveTermuxDependencies(index, NODE_PACKAGE);
    const root = path.join(workDir, 'termux');
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    for (const pkg of packages) {
        log(`下载 Termux 软件包 ${pkg.Package} ${pkg.Version}`);
        const deb = await download(`${mirror}/${pkg.Filename}`);
        const sha256 = crypto.createHash('sha256').update(deb).digest('hex');
        if (sha256 !== pkg.SHA256) throw new Error(`${pkg.Filename} 校验失败：${sha256} ≠ ${pkg.SHA256}`);
        const { name, data } = extractDebData(deb);
        const archive = path.join(workDir, `${pkg.Package}-${name}`);
        fs.writeFileSync(archive, data);
        run('tar', ['-xf', archive, '-C', root]);
        fs.rmSync(archive);
    }
    return {
        prefix: path.join(root, 'data', 'data', 'com.termux', 'files', 'usr'),
        versions: Object.fromEntries(packages.map((p) => [p.Package, p.Version])),
    };
}

function patchelf(args) {
    return run(process.env.PATCHELF || 'patchelf', args).trim();
}

/** 从 node 出发收集需要打包的动态库，返回 原库名 → 文件路径 */
function collectLibraries(entry, libDir) {
    const found = new Map();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.shift();
        for (const needed of patchelf(['--print-needed', file]).split('\n').filter(Boolean)) {
            if (SYSTEM_LIBRARIES.has(needed) || found.has(needed)) continue;
            const candidate = path.join(libDir, needed);
            if (!fs.existsSync(candidate)) throw new Error(`${path.basename(file)} 依赖的 ${needed} 不在 Termux 软件包中`);
            found.set(needed, candidate);
            queue.push(candidate);
        }
    }
    return found;
}

/** 复制 ELF 文件到 jniLibs 并改写库名：去掉 Termux 的 RUNPATH，依赖项改成打包后的名称 */
function installElf(src, dest, renames, soname) {
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
    const args = ['--remove-rpath'];
    if (soname) args.push('--set-soname', soname);
    for (const needed of patchelf(['--print-needed', dest]).split('\n').filter(Boolean)) {
        const renamed = renames.get(needed);
        if (renamed && renamed !== needed) args.push('--replace-needed', needed, renamed);
    }
    patchelf([...args, dest]);
}

function copyLicense(src, licensesDir, name) {
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(licensesDir, name));
}

/**
 * 组装安卓单机版运行时目录：
 *   <outDir>/jniLibs/arm64-v8a/  libnode.so、依赖库、libquery_engine.so、libschema_engine.so
 *   <outDir>/assets/server.zip   服务端（不含其他平台的 Prisma 引擎）
 *   <outDir>/assets/runtime.json 版本信息，应用据此判断是否需要重新解压
 *   <outDir>/assets/licenses/    内置组件的许可证
 */
export async function buildAndroidRuntime({ bundleDir, enginesDir, outDir, workDir, version, log = console.log }) {
    for (const file of ['libquery_engine.so', 'schema-engine']) {
        if (!fs.existsSync(path.join(enginesDir, file))) {
            throw new Error(`${enginesDir} 中缺少 ${file}，请先执行 scripts/package/build-android-prisma-engines.sh`);
        }
    }
    fs.rmSync(outDir, { recursive: true, force: true });
    const jniDir = path.join(outDir, 'jniLibs', ANDROID_ABI);
    const assetsDir = path.join(outDir, 'assets');
    const licensesDir = path.join(assetsDir, 'licenses');
    for (const dir of [jniDir, licensesDir, workDir]) fs.mkdirSync(dir, { recursive: true });

    const { prefix, versions } = await fetchTermuxNode(workDir, log);
    const libDir = path.join(prefix, 'lib');
    const nodeBin = path.join(prefix, 'bin', 'node');
    const libraries = collectLibraries(nodeBin, libDir);
    const renames = new Map([...libraries.keys()].map((name) => [name, androidLibraryName(name)]));
    log(`打包 Node.js ${versions[NODE_PACKAGE]} 及依赖库：${[...renames.values()].join(', ')}`);

    installElf(nodeBin, path.join(jniDir, 'libnode.so'), renames);
    for (const [name, file] of libraries) installElf(file, path.join(jniDir, renames.get(name)), renames, renames.get(name));
    fs.copyFileSync(path.join(enginesDir, 'libquery_engine.so'), path.join(jniDir, 'libquery_engine.so'));
    fs.copyFileSync(path.join(enginesDir, 'schema-engine'), path.join(jniDir, 'libschema_engine.so'));

    for (const pkg of Object.keys(versions)) {
        const docDir = path.join(prefix, 'share', 'doc', pkg);
        if (!fs.existsSync(docDir)) continue;
        for (const file of fs.readdirSync(docDir)) {
            if (/^(copyright|license)/i.test(file)) copyLicense(path.join(docDir, file), licensesDir, `${pkg}-${file}.txt`);
        }
    }
    copyLicense(path.join(enginesDir, 'LICENSE'), licensesDir, 'prisma-engines-LICENSE.txt');

    // 服务端：去掉构建机平台的 Prisma 引擎，安卓上改用 jniLibs 中的引擎
    const serverDir = path.join(workDir, 'server');
    fs.rmSync(serverDir, { recursive: true, force: true });
    fs.cpSync(bundleDir, serverDir, { recursive: true, verbatimSymlinks: true });
    const enginePattern = /^((lib)?query_engine[-_.].*\.node|schema-engine-.*)$/;
    for (const dir of [path.join('node_modules', '.prisma', 'client'), path.join('node_modules', '@prisma', 'engines')]) {
        const full = path.join(serverDir, dir);
        if (!fs.existsSync(full)) continue;
        for (const name of fs.readdirSync(full)) if (enginePattern.test(name)) fs.rmSync(path.join(full, name));
    }
    const zip = path.join(assetsDir, 'server.zip');
    run('zip', ['-q', '-r', '-X', '-9', zip, '.'], { cwd: serverDir });

    const engineCommit = fs.existsSync(path.join(enginesDir, 'COMMIT'))
        ? fs.readFileSync(path.join(enginesDir, 'COMMIT'), 'utf8').trim()
        : 'unknown';
    const serverSha256 = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    fs.writeFileSync(path.join(assetsDir, 'runtime.json'), `${JSON.stringify({
        version,
        serverSha256,
        node: versions[NODE_PACKAGE],
        prismaEngines: engineCommit,
        termux: versions,
    }, null, 2)}\n`);
    log(`安卓运行时已就绪：${path.relative(process.cwd(), outDir)}（server.zip ${(fs.statSync(zip).size / 1048576).toFixed(0)}MB）`);
}

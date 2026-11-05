/**
 * 飞牛OS 安装向导设置管理员：install_callback 调用，把向导中填写的邮箱和密码哈希
 * 写入配置目录的 initial-admin.json（不保存明文密码），服务首次启动时据此创建管理员。
 * 邮箱和密码经环境变量传入，避免出现在进程参数中。
 *
 * 向导中同意的使用协议版本经 WN_EULA_ACCEPTED 传入（如 v1），格式不对时忽略，按未同意处理。
 *
 * 用法：WN_ADMIN_EMAIL=… WN_ADMIN_PASSWORD=… [WN_EULA_ACCEPTED=v1] node initial-admin.mjs <服务端目录> <输出文件>
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [serverDir, outFile] = process.argv.slice(2);
const email = (process.env.WN_ADMIN_EMAIL || '').trim();
const password = process.env.WN_ADMIN_PASSWORD || '';
const eulaVersion = (process.env.WN_EULA_ACCEPTED || '').trim();

if (!serverDir || !outFile) {
    console.error('用法：node initial-admin.mjs <服务端目录> <输出文件>');
    process.exit(2);
}
// 与服务端初始化接口的校验一致
if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    console.error('管理员邮箱格式不正确');
    process.exit(1);
}
if (password.length < 6 || password === '123456') {
    console.error('管理员密码至少 6 位，且不能是 123456');
    process.exit(1);
}

// standalone 构建只保留 bcryptjs 的 ESM 入口（index.js），不能用 require 加载
const { default: bcrypt } = await import(pathToFileURL(path.join(serverDir, 'node_modules', 'bcryptjs', 'index.js')).href);
const content = JSON.stringify({
    email,
    name: 'Admin',
    passwordHash: bcrypt.hashSync(password, 12),
    // 与服务端 initial-admin.ts 的校验一致
    ...(/^v\d{1,4}$/.test(eulaVersion) ? { eulaAcceptedVersion: eulaVersion } : {}),
});

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const tmp = `${outFile}.tmp`;
fs.writeFileSync(tmp, content, { mode: 0o600 });
fs.renameSync(tmp, outFile);

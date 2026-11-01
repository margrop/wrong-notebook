// 仅由隔离测试启动器预加载，所有运行时 TCP 外连必须指向声明的本地服务。
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node.js 的 --require 预加载入口需要 CommonJS。
const net = require('node:net');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- 预加载器在应用模块执行前同步安装网络限制。
const fs = require('node:fs');
const original = net.Socket.prototype.connect;
const allowedPorts = new Set((process.env.E2E_ALLOWED_PORTS || '').split(',').map(Number));
net.Socket.prototype.connect = function (...arguments_) {
    let options = arguments_[0];
    if (Array.isArray(options)) options = options[0];
    if (typeof options !== 'object') options = { port: options, host: typeof arguments_[1] === 'string' ? arguments_[1] : 'localhost' };
    if (options?.path) return original.apply(this, arguments_);
    const host = options?.host || options?.hostname || 'localhost';
    const port = Number(options?.port);
    if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !allowedPorts.has(port)) {
        fs.appendFileSync(process.env.E2E_NETWORK_LOG, JSON.stringify({ host, port }) + '\n');
        throw new Error('E2E_EXTERNAL_CONNECTION_BLOCKED');
    }
    return original.apply(this, arguments_);
};

/** 只保留本地服务的数字端口，禁止文件内容成为请求的主机、路径或查询参数。 */
export function parseLoopbackOrigin(value: unknown): string {
    if (typeof value !== 'string') throw new Error('E2E 服务地址必须是本机 HTTP 地址');
    const url = new URL(value);
    const port = Number(url.port);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('E2E 服务地址必须只包含 127.0.0.1 和有效端口');
    }
    return `http://127.0.0.1:${port}`;
}

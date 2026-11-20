import "server-only";

/** 请求体超过路由上限时抛出，避免把超大 JSON 继续交给业务解析。 */
export class RequestBodyTooLargeError extends Error {
    constructor() {
        super('REQUEST_BODY_TOO_LARGE');
        this.name = 'RequestBodyTooLargeError';
    }
}

/** 读取并解析 JSON，同时限制 Content-Length 与实际读取到的字节数。 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
    const contentLength = Number(req.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new RequestBodyTooLargeError();
    }

    const bytes = await req.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
        throw new RequestBodyTooLargeError();
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
        return null;
    }
}

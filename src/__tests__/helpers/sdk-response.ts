/**
 * 模拟 OpenAI / Anthropic SDK 的 APIPromise：既可直接 await 得到数据，也支持 .withResponse() 取响应头。
 * 测试里的 create mock 照常 mockResolvedValue 数据；需要响应头时返回 withHeaders(data, headers)。
 */

const HEADERS = Symbol('sdk-response-headers');

interface WithHeaders<T> {
    [HEADERS]: Record<string, string>;
    data: T;
}

/** 让 mock 返回的数据带上响应头（如请求 ID） */
export function withHeaders<T>(data: T, headers: Record<string, string>): T {
    return { [HEADERS]: headers, data } as WithHeaders<T> as unknown as T;
}

function unwrap<T>(value: T): { data: T; headers: Record<string, string> } {
    if (value && typeof value === 'object' && HEADERS in value) {
        const wrapped = value as unknown as WithHeaders<T>;
        return { data: wrapped.data, headers: wrapped[HEADERS] };
    }
    return { data: value, headers: {} };
}

/** 包装 mock 方法：调用记录照常保留在原 mock 上，返回值额外支持 .withResponse() */
export function sdkMethod<A extends unknown[], T>(fn: (...args: A) => T | Promise<T>) {
    return (...args: A) => {
        const settled = Promise.resolve(fn(...args)).then(unwrap);
        const promise = settled.then(({ data }) => data);
        // 调用方只会消费 promise 或 withResponse 其中之一，另一支的失败不应成为未处理的拒绝
        promise.catch(() => undefined);
        return Object.assign(promise, {
            withResponse: async () => {
                const { data, headers } = await settled;
                return { data, response: new Response(null, { headers }), request_id: null };
            },
        });
    };
}

import { describe, expect, it } from 'vitest';
import { PROMISE_WITH_RESOLVERS_POLYFILL_SCRIPT } from '@/lib/promise-with-resolvers-polyfill';

/** 在旧内核构造器上执行首屏脚本；new Function 的参数 Promise 覆盖全局实现 */
function runPolyfill(constructor: typeof Promise): void {
    const execute = new Function('Promise', PROMISE_WITH_RESOLVERS_POLYFILL_SCRIPT) as (promiseConstructor: typeof Promise) => void;
    execute(constructor);
}

interface Resolvers<T> {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
}

/** 旧内核构造器可能没有该静态方法 */
interface MaybePromiseWithResolversConstructor {
    withResolvers?: <T>() => Resolvers<T>;
}

/** 脚本安装后的构造器 */
interface PromiseWithResolversConstructor {
    withResolvers: <T>() => Resolvers<T>;
}

describe('Promise.withResolvers 首屏兜底', () => {
    it('旧内核缺少 API 时安装，并正确完成 resolve', async () => {
        class LegacyPromise<T> extends Promise<T> {}
        Object.defineProperty(LegacyPromise, 'withResolvers', { value: undefined, configurable: true, writable: true });
        const legacy = LegacyPromise as unknown as MaybePromiseWithResolversConstructor; // 静态属性由脚本运行时写入，编译器看不到
        expect(legacy.withResolvers).toBeUndefined();

        runPolyfill(LegacyPromise as typeof Promise);

        const installed = LegacyPromise as unknown as PromiseWithResolversConstructor;
        const resolvers = installed.withResolvers<string>();
        resolvers.resolve('ok');
        await expect(resolvers.promise).resolves.toBe('ok');
    });

    it('旧内核缺少 API 时安装，并正确完成 reject', async () => {
        class LegacyPromise<T> extends Promise<T> {}
        Object.defineProperty(LegacyPromise, 'withResolvers', { value: undefined, configurable: true, writable: true });

        runPolyfill(LegacyPromise as typeof Promise);

        const installed = LegacyPromise as unknown as PromiseWithResolversConstructor;
        const resolvers = installed.withResolvers<string>();
        resolvers.reject(new Error('legacy-reject'));
        await expect(resolvers.promise).rejects.toThrow('legacy-reject');
    });

    it('已有实现时不覆盖', () => {
        class ModernPromise<T> extends Promise<T> {}
        const existing = <T>() => ({
            promise: Promise.resolve('kept' as T),
            resolve: () => undefined,
            reject: () => undefined,
        });
        Object.defineProperty(ModernPromise, 'withResolvers', { value: existing, configurable: true });

        runPolyfill(ModernPromise as typeof Promise);

        const installed = ModernPromise as unknown as PromiseWithResolversConstructor;
        expect(installed.withResolvers).toBe(existing);
    });
});

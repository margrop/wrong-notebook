/**
 * 同一模型 AI 调用并发限制单元测试
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ config: { aiConcurrencyLimit: 2 } as { aiConcurrencyLimit?: number } }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => mocks.config }));

import { getModelConcurrencyState, limitModelConcurrency, runWithModelConcurrency } from '@/lib/ai/concurrency';

/** 返回一个可手动完成的任务 */
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('runWithModelConcurrency', () => {
    beforeEach(() => {
        mocks.config = { aiConcurrencyLimit: 2 };
    });

    it('超过上限的调用排队，名额释放后按顺序执行', async () => {
        const tasks = [deferred(), deferred(), deferred()];
        const started: number[] = [];
        const runs = tasks.map((task, index) => runWithModelConcurrency('m1', async () => {
            started.push(index);
            await task.promise;
            return index;
        }));

        await flush();
        expect(started).toEqual([0, 1]);
        expect(getModelConcurrencyState('m1')).toEqual({ active: 2, waiting: 1 });

        tasks[0].resolve();
        await flush();
        expect(started).toEqual([0, 1, 2]);

        tasks[1].resolve();
        tasks[2].resolve();
        expect(await Promise.all(runs)).toEqual([0, 1, 2]);
        expect(getModelConcurrencyState('m1')).toEqual({ active: 0, waiting: 0 });
    });

    it('不同模型各自计数', async () => {
        const block = deferred();
        const a = [runWithModelConcurrency('a', () => block.promise), runWithModelConcurrency('a', () => block.promise)];
        const started = vi.fn();
        const b = runWithModelConcurrency('b', async () => started());

        await b;
        expect(started).toHaveBeenCalled();
        block.resolve();
        await Promise.all(a);
    });

    it('调用失败也会释放名额', async () => {
        mocks.config = { aiConcurrencyLimit: 1 };
        await expect(runWithModelConcurrency('err', async () => { throw new Error('429'); })).rejects.toThrow('429');
        expect(await runWithModelConcurrency('err', async () => 'ok')).toBe('ok');
    });

    it('调高上限后排队的调用随下一次释放一并放行', async () => {
        mocks.config = { aiConcurrencyLimit: 1 };
        const tasks = [deferred(), deferred(), deferred()];
        const started: number[] = [];
        const runs = tasks.map((task, index) => runWithModelConcurrency('raise', async () => {
            started.push(index);
            await task.promise;
        }));
        await flush();
        expect(started).toEqual([0]);

        mocks.config = { aiConcurrencyLimit: 3 };
        tasks[0].resolve();
        await flush();
        expect(started).toEqual([0, 1, 2]);
        tasks[1].resolve();
        tasks[2].resolve();
        await Promise.all(runs);
    });

    it('配置无效时使用默认上限 5', async () => {
        mocks.config = { aiConcurrencyLimit: 0 };
        const block = deferred();
        const started: number[] = [];
        const runs = Array.from({ length: 6 }, (_, index) => runWithModelConcurrency('default', async () => {
            started.push(index);
            await block.promise;
        }));
        await flush();
        expect(started).toHaveLength(5);
        block.resolve();
        await Promise.all(runs);
    });
});

describe('limitModelConcurrency', () => {
    it('包装后的方法受并发限制，内部互相调用不重复排队', async () => {
        mocks.config = { aiConcurrencyLimit: 1 };
        const service = {
            async outer() { return this.inner(); },
            async inner() { return 'done'; },
        };
        const limited = limitModelConcurrency(service, 'svc');

        expect(await limited.outer()).toBe('done');
        expect(getModelConcurrencyState('svc')).toEqual({ active: 0, waiting: 0 });
    });
});

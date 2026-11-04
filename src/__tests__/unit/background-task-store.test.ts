/**
 * 后台任务共享轮询 store：与「后台任务」按钮和 useRunningTask 共用一份结果，
 * 有 running 任务时快轮询、无任务时慢轮询；页面不可见时暂停；refresh() 手动刷新
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
    vi.useFakeTimers();
    // 清理全局单例，使每次动态 import 都拿到新的 store
    delete (globalThis as { __backgroundTaskStore?: unknown }).__backgroundTaskStore;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function importStore() {
    // 每次重新导入以重置模块级单例
    vi.resetModules();
    const mod = await import('@/lib/background-task-store');
    return mod.backgroundTaskStore;
}

const tasksResponse = (tasks: unknown[]) => json({ tasks });

describe('backgroundTaskStore', () => {
    it('refresh 拉取任务并通知订阅者', async () => {
        const store = await importStore();
        fetchMock.mockResolvedValueOnce(tasksResponse([{ id: 't1', kind: 'fix_text', status: 'running' }]));
        const listener = vi.fn();
        store.subscribe(listener);
        await store.refresh();
        expect(listener).toHaveBeenCalledWith([expect.objectContaining({ id: 't1', status: 'running' })]);
        expect(store.getSnapshot()).toHaveLength(1);
    });

    it('有 running 任务时按 3 秒轮询，无任务时放慢到 15 秒', async () => {
        const store = await importStore();
        // refresh 后注册 interval：running → 3 秒
        fetchMock.mockResolvedValueOnce(tasksResponse([{ id: 't1', kind: 'fix_text', status: 'running' }]));
        store.subscribe(vi.fn());
        await store.refresh();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        fetchMock.mockResolvedValueOnce(tasksResponse([{ id: 't1', kind: 'fix_text', status: 'running' }]));
        await vi.advanceTimersByTimeAsync(3000);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        // 上一轮仍是 running，interval 仍是 3 秒；本次返回空 → 下次 reschedule 为 15 秒
        fetchMock.mockResolvedValueOnce(tasksResponse([]));
        await vi.advanceTimersByTimeAsync(3000);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        // 3 秒内不应再有请求（interval 已切到 15 秒）
        fetchMock.mockResolvedValueOnce(tasksResponse([]));
        await vi.advanceTimersByTimeAsync(3000);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        // 15 秒后触发
        await vi.advanceTimersByTimeAsync(12000);
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('页面不可见时暂停轮询', async () => {
        const store = await importStore();
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        try {
            fetchMock.mockResolvedValueOnce(tasksResponse([{ id: 't1', kind: 'fix_text', status: 'running' }]));
            store.subscribe(vi.fn());
            await store.refresh();
            expect(fetchMock).toHaveBeenCalledTimes(1);

            fetchMock.mockResolvedValue(tasksResponse([]));
            await vi.advanceTimersByTimeAsync(10000);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        }
    });

    it('取消订阅后不再接收通知', async () => {
        const store = await importStore();
        fetchMock.mockResolvedValueOnce(tasksResponse([]));
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        await store.refresh();
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        fetchMock.mockResolvedValueOnce(tasksResponse([{ id: 't2', kind: 'exam', status: 'running' }]));
        await store.refresh();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('refresh 失败时保留上次结果', async () => {
        const store = await importStore();
        fetchMock.mockResolvedValueOnce(tasksResponse([{ id: 't1', kind: 'fix_text', status: 'running' }]));
        store.subscribe(vi.fn());
        await store.refresh();
        expect(store.getSnapshot()).toHaveLength(1);

        fetchMock.mockRejectedValueOnce(new Error('network down'));
        await store.refresh();
        expect(store.getSnapshot()).toHaveLength(1);
    });
});

/**
 * useRunningTask：查询当前用户在指定 target 上正在运行的后台任务；
 * 与「后台任务」按钮共用同一份轮询结果；target 为 null 时不发起请求
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundTask } from '@/lib/background-tasks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchMock = vi.fn();
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

interface HookResult {
    running: BackgroundTask | null;
    refresh: () => Promise<void>;
}

let hookResult: HookResult | null = null;
let root: Root | null = null;
let container: HTMLDivElement;

function Consumer({ target, useHook }: { target: string | null; useHook: (t: string | null) => HookResult }) {
    const result = useHook(target);
    useEffect(() => {
        hookResult = result;
    });
    return null;
}

beforeEach(() => {
    vi.resetModules();
    // 清理全局单例，使每次动态 import 都拿到新的 store
    delete (globalThis as { __backgroundTaskStore?: unknown }).__backgroundTaskStore;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    hookResult = null;
});

afterEach(async () => {
    if (root) {
        await act(async () => root!.unmount());
        root = null;
    }
    container?.remove();
    vi.unstubAllGlobals();
});

async function renderWith(useHook: (t: string | null) => HookResult, target: string | null) {
    const { createElement } = await import('react');
    await act(async () => {
        root = createRoot(container);
        root.render(createElement(Consumer, { target, useHook }));
    });
}

const fixTextTask = (batchId: string): BackgroundTask => ({
    id: `task-${batchId}`,
    kind: 'fix_text',
    subject: `第 1 题 ${batchId}`,
    status: 'running',
    progress: null,
    error: null,
    link: `/import-batches/${batchId}`,
    target: `import-batch:${batchId}:fix-text`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
});

describe('useRunningTask', () => {
    it('running 返回当前用户在指定 target 上正在运行的任务', async () => {
        const { useRunningTask } = await import('@/lib/hooks/use-running-task');
        const batchId = 'abc123';
        fetchMock.mockResolvedValueOnce(json({ tasks: [fixTextTask(batchId)] }));
        await renderWith(useRunningTask, `import-batch:${batchId}:fix-text`);
        expect(hookResult?.running?.target).toBe(`import-batch:${batchId}:fix-text`);
        expect(hookResult?.running?.kind).toBe('fix_text');
    });

    it('任务结束后 running 变为 null', async () => {
        const { useRunningTask } = await import('@/lib/hooks/use-running-task');
        const batchId = 'abc123';
        const running = fixTextTask(batchId);
        fetchMock.mockResolvedValueOnce(json({ tasks: [running] }));
        await renderWith(useRunningTask, `import-batch:${batchId}:fix-text`);
        expect(hookResult?.running).not.toBeNull();

        fetchMock.mockResolvedValueOnce(json({ tasks: [{ ...running, status: 'succeeded', finishedAt: new Date().toISOString() }] }));
        await act(async () => { await hookResult!.refresh(); });
        expect(hookResult?.running).toBeNull();
    });

    it('其他 target 的任务不影响查询', async () => {
        const { useRunningTask } = await import('@/lib/hooks/use-running-task');
        fetchMock.mockResolvedValueOnce(json({ tasks: [fixTextTask('other-batch')] }));
        await renderWith(useRunningTask, 'import-batch:mine:fix-text');
        expect(hookResult?.running).toBeNull();
    });

    it('target 为 null 时不发起请求且 running 为 null', async () => {
        const { useRunningTask } = await import('@/lib/hooks/use-running-task');
        await renderWith(useRunningTask, null);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(hookResult?.running).toBeNull();
    });
});

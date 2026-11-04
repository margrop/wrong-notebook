/**
 * useDraftTextFix：刷新页面后的等待与结果恢复
 * - 页面刚加载（任务状态尚未取回、running 为 null）时不提示「其他页面完成」，也不清除记录的 requestId
 * - 刷新后任务仍在进行且本页记录了 requestId：取回原响应并写入草稿，结束时不提示「其他页面完成」
 * - 没有 requestId（另一台设备发起）：任务结束时提示「结果未同步到此页」
 */
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { useDraftTextFix } from '@/lib/hooks/use-draft-text-fix';
import type { BackgroundTask } from '@/lib/background-tasks';
import type { BatchDraft } from '@/lib/question-split/draft';

const mocks = vi.hoisted(() => ({
    recoverResponse: vi.fn(),
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
    setRunning: undefined as undefined | ((task: BackgroundTask | null) => void),
}));

vi.mock('@/lib/api-client', () => ({
    ApiError: class ApiError extends Error {},
    createRequestId: () => 'a'.repeat(32),
    recoverResponse: mocks.recoverResponse,
}));
vi.mock('@/lib/import/import-batch-client', () => ({ fixImportBatchText: vi.fn() }));
vi.mock('@/lib/feedback', () => ({ toast: { info: mocks.toastInfo, success: mocks.toastSuccess, warning: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/hooks/use-running-task', () => ({
    useRunningTask: () => {
        const [running, setRunning] = useState<BackgroundTask | null>(null);
        mocks.setRunning = setRunning;
        return { running, refresh: vi.fn() };
    },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const draft: BatchDraft = {
    items: [{ key: 'q1', label: '1', text: '计算 1+1', material: null, section: null, selected: true, regions: [], hasFigure: false, flags: [] }],
    ignored: [],
    warnings: [],
};
const runningTask = { id: 't1', kind: 'fix_text', subject: null, status: 'running', progress: null, error: null, link: null, target: 'import-batch:b1:fix-text', startedAt: new Date().toISOString(), finishedAt: null } as BackgroundTask;

let container: HTMLDivElement;
let root: Root;
const onEdit = vi.fn();

function Probe() {
    useDraftTextFix('b1', draft, onEdit);
    return null;
}

async function render() {
    root = createRoot(container);
    await act(async () => { root.render(<LanguageProvider><Probe /></LanguageProvider>); });
}

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

describe('useDraftTextFix 刷新后的等待与恢复', () => {
    it('页面刚加载、没有进行中的任务时不提示，也不清除记录的 requestId', async () => {
        sessionStorage.setItem('import-batch-text-fix:b1', JSON.stringify({ requestId: 'b'.repeat(32), keys: ['q1'] }));
        await render();
        expect(mocks.toastInfo).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('import-batch-text-fix:b1')).not.toBeNull();
    });

    it('刷新后任务仍在进行且有 requestId：取回结果写入草稿，结束时不提示其他页面完成', async () => {
        sessionStorage.setItem('import-batch-text-fix:b1', JSON.stringify({ requestId: 'b'.repeat(32), keys: ['q1'] }));
        mocks.recoverResponse.mockResolvedValue({ fixes: [{ key: 'q1', original: '计算 1+1', text: '计算 1 + 1', uncertain: [] }], unchanged: [], failed: [] });
        await render();
        await act(async () => { mocks.setRunning?.(runningTask); });
        await act(async () => { await vi.waitFor(() => expect(onEdit).toHaveBeenCalled()); });
        await act(async () => { mocks.setRunning?.(null); });
        expect(mocks.recoverResponse).toHaveBeenCalledWith('b'.repeat(32), expect.any(Number), expect.any(Error));
        expect(mocks.toastInfo).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('import-batch-text-fix:b1')).toBeNull();
    });

    it('没有 requestId（另一台设备发起）：任务结束时提示结果未同步到此页', async () => {
        await render();
        await act(async () => { mocks.setRunning?.(runningTask); });
        expect(mocks.recoverResponse).not.toHaveBeenCalled();
        await act(async () => { mocks.setRunning?.(null); });
        expect(mocks.toastInfo).toHaveBeenCalledTimes(1);
    });
});

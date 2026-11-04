/**
 * RegenerateAnswerButton：按目标防重复
 * - 刷新页面后若同 target 任务仍在进行，按钮显示进行中并禁用
 * - 收到 TASK_ALREADY_RUNNING（409）时提示并进入等待
 * - 任务结束（running 变为 null）后调用 onReload 重新加载页面数据
 *
 * 通过 mock useRunningTask 模拟后台任务轮询结果（running → null），
 * 避免 backgroundTaskStore 单例与轮询时序对断言的干扰。
 */
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegenerateAnswerButton } from '@/components/regenerate-answer-button';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { BackgroundTask } from '@/lib/background-tasks';

const mocks = vi.hoisted(() => ({
    post: vi.fn(),
    confirmDialog: vi.fn(),
    toastInfo: vi.fn(),
    toastError: vi.fn(),
    refresh: vi.fn(),
    // 测试用：把 mock hook 内部的状态 setter 暴露出来，便于模拟 running → null
    setRunning: undefined as undefined | ((task: BackgroundTask | null) => void),
    currentTarget: null as string | null,
}));

vi.mock('@/lib/api-client', () => ({
    ApiError: class ApiError extends Error {
        status: number;
        statusText: string;
        data: unknown;
        constructor(status: number, statusText: string, data: unknown) {
            super(`API Error: ${status} ${statusText}`);
            this.status = status;
            this.statusText = statusText;
            this.data = data;
        }
    },
    apiClient: { post: mocks.post },
}));
vi.mock('@/lib/feedback', () => ({
    toast: { info: mocks.toastInfo, error: mocks.toastError, success: vi.fn(), warning: vi.fn() },
    confirmDialog: mocks.confirmDialog,
}));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/hooks/use-running-task', () => ({
    useRunningTask: (target: string | null) => {
        const [running, setRunning] = useState<BackgroundTask | null>(null);
        mocks.setRunning = setRunning;
        mocks.currentTarget = target;
        return { running, refresh: mocks.refresh };
    },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.setRunning = undefined;
    mocks.currentTarget = null;
    mocks.confirmDialog.mockResolvedValue(true);
    mocks.post.mockResolvedValue({ answerText: '2', analysis: '1+1=2' });
    container = document.createElement('div');
    document.body.appendChild(container);
});

afterEach(async () => {
    if (root) {
        await act(async () => root.unmount());
        root = null as unknown as Root;
    }
    container?.remove();
});

interface OnDoneArgs {
    answerText: string | null;
    analysis: string | null;
}

async function render(onDone: (updated: OnDoneArgs) => void = () => undefined, onReload: () => void = () => undefined) {
    await act(async () => {
        root = createRoot(container);
        root.render(
            <LanguageProvider>
                <RegenerateAnswerButton errorItemId="e1" onDone={onDone} onReload={onReload} />
            </LanguageProvider>,
        );
    });
}

const button = () => container.querySelector('button');
const buttonDisabled = () => button()?.disabled ?? null;
const buttonText = () => button()?.textContent ?? '';

const runningTask: BackgroundTask = {
    id: 'task-1',
    kind: 'reanswer',
    subject: 'hA6PB9 求 1+1',
    status: 'running',
    progress: null,
    error: null,
    link: '/error-items/e1',
    target: 'error-item:e1:reanswer',
    startedAt: new Date().toISOString(),
    finishedAt: null,
};

describe('RegenerateAnswerButton 防重复', () => {
    it('刷新页面后任务仍在进行：按钮显示进行中并禁用，结束后恢复并触发 onReload', async () => {
        const onReload = vi.fn();
        await render(() => undefined, onReload);
        expect(buttonDisabled()).toBe(false);

        // 模拟刷新后 store 取到正在进行的任务
        await act(async () => { mocks.setRunning?.(runningTask); });
        expect(buttonDisabled()).toBe(true);
        expect(buttonText()).not.toContain('重新生成完整解答');
        expect(onReload).not.toHaveBeenCalled();

        // 任务结束后按钮恢复可用，并触发 onReload 重新加载数据
        await act(async () => { mocks.setRunning?.(null); });
        expect(buttonDisabled()).toBe(false);
        expect(onReload).toHaveBeenCalledTimes(1);
    });

    it('无进行中任务时按钮默认可用', async () => {
        await render();
        expect(buttonDisabled()).toBe(false);
    });

    it('收到 TASK_ALREADY_RUNNING（409）时提示并进入等待，不调用 onDone；等待的任务结束后触发 onReload', async () => {
        const onDone = vi.fn();
        const onReload = vi.fn();
        mocks.post.mockRejectedValueOnce(
            new (await import('@/lib/api-client')).ApiError(409, 'Conflict', { code: 'TASK_ALREADY_RUNNING' }),
        );

        await render(onDone, onReload);
        await act(async () => { button()?.click(); });

        await act(async () => { await vi.waitFor(() => expect(mocks.toastInfo).toHaveBeenCalled()); });
        expect(onDone).not.toHaveBeenCalled();
        // 进入等待：running 任务被 refresh 取到后按钮禁用
        await act(async () => { mocks.setRunning?.(runningTask); });
        expect(buttonDisabled()).toBe(true);
        // 其他页面发起的任务结束：重新加载数据以显示服务端已保存的结果
        await act(async () => { mocks.setRunning?.(null); });
        expect(onReload).toHaveBeenCalledTimes(1);
    });

    it('正常完成后调用 onDone 且不再触发 onReload', async () => {
        const onDone = vi.fn();
        const onReload = vi.fn();

        await render(onDone, onReload);
        await act(async () => { button()?.click(); });
        await act(async () => { await vi.waitFor(() => expect(onDone).toHaveBeenCalled()); });

        expect(onReload).not.toHaveBeenCalled();
    });
});

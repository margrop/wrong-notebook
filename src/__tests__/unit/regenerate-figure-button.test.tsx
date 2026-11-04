/**
 * RegenerateFigureButton：重绘配图按钮的防重复行为
 * - 页面加载时若已有同 target 任务在进行，按钮显示进行中并禁用
 * - 收到 TASK_ALREADY_RUNNING 时提示并进入等待
 * - 任务结束后重新加载配图数据
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
    postMock: vi.fn(),
    getMock: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
    apiClient: { post: mocks.postMock, get: mocks.getMock },
    ApiError: class ApiError extends Error {
        status: number;
        statusText: string;
        data: unknown;
        constructor(status: number, statusText: string, data: unknown) {
            super('ApiError');
            this.status = status;
            this.statusText = statusText;
            this.data = data;
        }
    },
}));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/feedback', () => ({ toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));

import { RegenerateFigureButton } from '@/components/regenerate-figure-button';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { toast } from '@/lib/feedback';
import { ApiError } from '@/lib/api-client';
import { backgroundTaskStore } from '@/lib/background-task-store';
import type { BackgroundTask } from '@/lib/background-tasks';

let container: HTMLDivElement;
let root: Root | null = null;

const figureTask = (errorItemId: string): BackgroundTask => ({
    id: 'task-1',
    kind: 'figure',
    subject: 'hA6PB9 求三角形面积',
    status: 'running',
    progress: null,
    error: null,
    link: `/error-items/${errorItemId}`,
    target: `error-item:${errorItemId}:figure`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
});

beforeEach(async () => {
    mocks.postMock.mockReset();
    mocks.getMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    // 重置 store 缓存为空任务列表，避免测试间污染
    mocks.getMock.mockResolvedValueOnce({ tasks: [] });
    await backgroundTaskStore.refresh();
    mocks.getMock.mockReset();
});

afterEach(async () => {
    if (root) {
        await act(async () => root!.unmount());
        root = null;
    }
    container?.remove();
});

const renderButton = async (errorItemId: string, onDone: (figure: { hasFigure: boolean; figureSvg: string | null }) => void) => {
    const { createElement } = await import('react');
    await act(async () => {
        root = createRoot(container);
        root.render(createElement(LanguageProvider, null,
            createElement(RegenerateFigureButton, { errorItemId, onDone })));
    });
};

describe('RegenerateFigureButton 防重复', () => {
    it('页面加载时已有同 target 任务在进行：按钮禁用并显示进行中', async () => {
        const errorItemId = 'e1';
        await renderButton(errorItemId, () => undefined);
        mocks.getMock.mockResolvedValueOnce({ tasks: [figureTask(errorItemId)] });
        await act(async () => { await backgroundTaskStore.refresh(); });

        const button = container.querySelector('button');
        expect(button).not.toBeNull();
        expect(button!.disabled).toBe(true);
    });

    it('任务结束后按钮恢复可用，并重新加载配图数据', async () => {
        const errorItemId = 'e1';
        const onDone = vi.fn();
        const running = figureTask(errorItemId);
        await renderButton(errorItemId, onDone);
        mocks.getMock.mockResolvedValueOnce({ tasks: [running] });
        await act(async () => { await backgroundTaskStore.refresh(); });

        // 确认按钮禁用
        expect(container.querySelector('button')!.disabled).toBe(true);

        // 任务结束
        mocks.getMock.mockResolvedValueOnce({ tasks: [{ ...running, status: 'succeeded', finishedAt: new Date().toISOString() }] });
        mocks.getMock.mockResolvedValueOnce({ hasFigure: true, figureSvg: '<svg/>' });
        await act(async () => { await backgroundTaskStore.refresh(); });

        const button = container.querySelector('button');
        expect(button!.disabled).toBe(false);
        expect(mocks.getMock).toHaveBeenCalledWith(`/api/error-items/${errorItemId}`);
        expect(onDone).toHaveBeenCalledWith({ hasFigure: true, figureSvg: '<svg/>' });
    });

    it('收到 TASK_ALREADY_RUNNING 时提示并进入等待', async () => {
        const errorItemId = 'e1';
        await renderButton(errorItemId, () => undefined);
        mocks.getMock.mockResolvedValueOnce({ tasks: [] });
        await act(async () => { await backgroundTaskStore.refresh(); });

        mocks.postMock.mockRejectedValueOnce(new ApiError(409, 'Conflict', { code: 'TASK_ALREADY_RUNNING', details: { task: figureTask(errorItemId) } }));
        mocks.getMock.mockResolvedValueOnce({ tasks: [figureTask(errorItemId)] });

        const button = container.querySelector('button')!;
        expect(button.disabled).toBe(false);
        await act(async () => { button.click(); });

        expect(toast.info).toHaveBeenCalled();
        expect(mocks.postMock).toHaveBeenCalledTimes(1);

        // 按钮应进入等待状态
        await act(async () => { await backgroundTaskStore.refresh(); });
        expect(container.querySelector('button')!.disabled).toBe(true);
    });
});

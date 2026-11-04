/**
 * ExamQuestionRegenerate：试卷单题「重新生成」按钮接入 useRunningTask 防重复。
 * - useRunningTask 收到与服务端约定一致的 target
 * - running 时按钮禁用（刷新后仍在执行时不可重复触发）
 * - 没有 running 任务时按钮可用
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamQuestionRegenerate } from '@/components/exam/exam-question-regenerate';
import { LanguageProvider } from '@/contexts/LanguageContext';

vi.mock('@/lib/api-client', () => ({
    apiClient: { post: vi.fn() },
    ApiError: class ApiError extends Error {
        status: number;
        data: unknown;
        constructor(status: number, data: unknown) { super('ApiError'); this.status = status; this.data = data; }
    },
}));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/feedback', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }, confirmDialog: vi.fn(async () => true) }));

// mock useRunningTask：由测试直接控制 running 状态
const useRunningTaskMock = vi.fn();
vi.mock('@/lib/hooks/use-running-task', () => ({
    useRunningTask: (target: string | null) => useRunningTaskMock(target),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useRunningTaskMock.mockReset();
    useRunningTaskMock.mockReturnValue({ running: null, refresh: vi.fn() });
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

const question = {
    id: 'q1',
    order: 1,
    sourceShortId: 'A1',
    status: 'ready' as const,
    questionText: '旧题',
    answerText: '旧答',
    analysis: '旧析',
    figureSvg: null,
    error: null,
    errorItemId: 'ei1',
    attempts: [] as import('@/types/api').ExamQuestionAttempt[],
    figureScale: 100,
    figureAlign: 'center' as const,
    answerSpacePx: null,
    score: null,
    questionType: null,
    errorItemQuestionType: null,
    notebookName: '数学',
};

async function renderRegenerate() {
    await act(async () => root.render(
        <LanguageProvider>
            <ExamQuestionRegenerate paperId="p1" paperMode="generate" question={question} onDone={vi.fn()} />
        </LanguageProvider>,
    ));
}

function buttons(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll('button'));
}

describe('ExamQuestionRegenerate 防重复', () => {
    it('useRunningTask 收到与服务端约定一致的 target', async () => {
        await renderRegenerate();
        expect(useRunningTaskMock).toHaveBeenCalledWith('exam-question:q1:regenerate');
    });

    it('没有 running 任务时按钮可用', async () => {
        await renderRegenerate();
        expect(buttons().some((btn) => btn.disabled)).toBe(false);
    });

    it('running 时按钮禁用（刷新后仍在执行时不可重复触发）', async () => {
        useRunningTaskMock.mockReturnValue({
            running: {
                id: 'task-1',
                kind: 'exam',
                subject: '试卷',
                status: 'running',
                progress: null,
                error: null,
                link: '/exams/p1',
                target: 'exam-question:q1:regenerate',
                startedAt: new Date().toISOString(),
                finishedAt: null,
            },
            refresh: vi.fn(),
        });
        await renderRegenerate();
        expect(buttons().some((btn) => btn.disabled)).toBe(true);
    });
});

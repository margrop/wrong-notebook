/**
 * 题目导入流程：免确认直接入库、人工校对后保存、文字解题与识别失败提示
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { useQuestionImport } from '@/lib/use-question-import';
import { translations } from '@/lib/translations';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    push: vi.fn(),
    confirmBeforeImport: false,
    saveParsedQuestion: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    createImportTask: vi.fn(),
    fetchImportTask: vi.fn(),
    markImportTaskRead: vi.fn(async () => undefined),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/question-import', () => ({
    fetchConfirmBeforeImport: vi.fn(async () => mocks.confirmBeforeImport),
    saveParsedQuestion: mocks.saveParsedQuestion,
}));
vi.mock('@/lib/image-utils', () => ({ processImageFile: vi.fn(async () => 'data:image/jpeg;base64,AAAA') }));
vi.mock('@/lib/feedback', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/lib/import-task-client', () => ({
    createImportTask: mocks.createImportTask,
    fetchImportTask: mocks.fetchImportTask,
    markImportTaskRead: mocks.markImportTaskRead,
    onReturnToForeground: () => () => undefined,
}));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const parsed = { questionText: '1 + 1 = ?', answerText: '2', analysis: '加法', knowledgePoints: ['加法'], subject: '数学', requiresImage: false };
const IMAGE = 'data:image/jpeg;base64,AAAA';
const task = (patch: object = {}) => ({
    id: 'task-1', status: 'analyzing', mode: 'auto', subjectId: null, targetSubjectId: null, excerpt: null, error: null,
    errorItemId: null, errorItemShortId: null, notebookName: null, duplicate: false, hasResult: false, unread: false,
    attempts: 1, timings: {}, createdAt: '2026-11-03T00:00:00.000Z', finishedAt: null, result: null, imageData: IMAGE, paperLevel: null,
    ...patch,
});
/** 等待任务查询（首次查询放在下一轮事件循环） */
const flushTimers = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

type Flow = ReturnType<typeof useQuestionImport>;
type Options = Parameters<typeof useQuestionImport>[0];

let root: Root;
let container: HTMLDivElement;
let flow: Flow;

// 每次渲染后把 hook 的最新返回值交给测试
function Probe({ options, onRender }: { options: Options; onRender: (value: Flow) => void }) {
    const value = useQuestionImport(options);
    useEffect(() => onRender(value));
    return null;
}

async function render(options: Partial<Options> = {}) {
    await act(async () => {
        root.render(<LanguageProvider><Probe options={{ logPrefix: '[Test]', ...options }} onRender={(value) => { flow = value; }} /></LanguageProvider>);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirmBeforeImport = false;
    mocks.get.mockResolvedValue({ timeouts: { analyze: 120000 } });
    mocks.saveParsedQuestion.mockResolvedValue({ id: 'saved', duplicate: false });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('题目导入流程', () => {
    it('未开启人工确认时上传后创建服务端任务，不再遮挡页面；服务端入库后状态卡显示已保存，不自动标记已读', async () => {
        mocks.createImportTask.mockResolvedValueOnce(task());
        mocks.fetchImportTask.mockResolvedValue(task({ status: 'saved', errorItemId: 'saved', errorItemShortId: 'AbC234', notebookName: '数学', unread: true }));
        await render({ analyzeSubjectId: 'nb-1', importSubjectId: 'nb-1' });

        await act(async () => flow.cropComplete(new Blob(['x'])));
        expect(mocks.createImportTask).toHaveBeenCalledWith(expect.objectContaining({
            imageBase64: IMAGE, subjectId: 'nb-1', targetSubjectId: 'nb-1', clientTimings: { compress: expect.any(Number) },
        }));
        expect(flow.analysisStep).toBe('idle');
        await flushTimers();

        expect(flow.pendingTask).toMatchObject({ id: 'task-1', status: 'saved', errorItemId: 'saved', unread: true });
        expect(mocks.markImportTaskRead).not.toHaveBeenCalled();
        expect(flow.step).toBe('upload');
        expect(mocks.post).not.toHaveBeenCalledWith('/api/analyze', expect.anything(), expect.anything());
    });

    it('识别中时页面显示任务状态卡，可继续操作', async () => {
        mocks.createImportTask.mockResolvedValueOnce(task());
        mocks.fetchImportTask.mockResolvedValue(task());
        await render();
        await act(async () => flow.cropComplete(new Blob(['x'])));
        await flushTimers();
        expect(flow.pendingTask).toMatchObject({ id: 'task-1', status: 'analyzing' });
        expect(flow.isBusy).toBe(false);
        await act(async () => flow.dismissPendingTask());
        expect(flow.pendingTask).toBeNull();
    });

    it('开启人工确认时任务待校对只更新状态卡，由用户主动进入校对页；固定错题本随任务提交', async () => {
        mocks.confirmBeforeImport = true;
        mocks.createImportTask.mockResolvedValueOnce(task({ mode: 'review' }));
        mocks.fetchImportTask.mockResolvedValue(task({ mode: 'review', status: 'review', result: parsed, hasResult: true, unread: true }));
        await render({ fixedSubjectId: 'nb-2' });
        await act(async () => {});

        await act(async () => flow.cropComplete(new Blob(['x'])));
        expect(mocks.createImportTask).toHaveBeenCalledWith(expect.objectContaining({ targetSubjectId: 'nb-2' }));
        await flushTimers();
        expect(flow.pendingTask).toMatchObject({ status: 'review', unread: true });
        expect(flow.step).toBe('upload');
        expect(flow.parsedData).toBeNull();
        expect(mocks.markImportTaskRead).not.toHaveBeenCalled();
    });

    it('旧任务完成时用户正在录入新题，不打断当前输入', async () => {
        mocks.confirmBeforeImport = true;
        mocks.createImportTask.mockResolvedValueOnce(task({ mode: 'review' }));
        mocks.fetchImportTask.mockResolvedValue(task({ mode: 'review' }));
        await render();
        await act(async () => {});
        await act(async () => flow.cropComplete(new Blob(['x'])));
        await flushTimers();
        expect(flow.pendingTask?.status).toBe('analyzing');

        // 用户开始裁剪下一张图片时，上一题识别完成
        vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:next', revokeObjectURL: () => undefined });
        await act(async () => flow.selectImage(new File(['y'], 'next.jpg', { type: 'image/jpeg' })));
        mocks.fetchImportTask.mockResolvedValue(task({ mode: 'review', status: 'review', result: parsed, hasResult: true, unread: true }));
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        await act(async () => { await flow.refreshPendingTask(); });
        expect(flow.pendingTask?.status).toBe('review');
        expect(flow.isCropperOpen).toBe(true);
        expect(flow.croppingImage).toBe('blob:next');
        expect(flow.step).toBe('upload');
        expect(flow.parsedData).toBeNull();
        expect(mocks.markImportTaskRead).not.toHaveBeenCalled();
    });

    it('保存时识别为重复题则跳到原题', async () => {
        await render();
        mocks.post.mockResolvedValueOnce({ id: 'existing', duplicate: true });
        await act(async () => { await flow.saveQuestion({ questionText: 'q', subjectId: 'nb-1' }); });
        expect(mocks.push).toHaveBeenCalledWith('/error-items/existing');
    });

    it('直接保存失败保留具体原因，不跳转，重试成功后清除原因', async () => {
        await render();
        mocks.post.mockRejectedValueOnce({ status: 502, data: {
            message: 'QUESTION_SAVE_GRADE_FAILED', code: 'AI_ERROR', details: { reason: 'AI_AUTH_ERROR' },
        } });
        await act(async () => { expect(await flow.saveQuestion({ questionText: 'q', subjectId: 'nb-1' })).toBe(false); });
        expect(flow.saveError).toContain(translations.zh.errors.QUESTION_SAVE_GRADE_FAILED);
        expect(flow.saveError).toContain(translations.zh.errors.AI_AUTH_ERROR);
        expect(mocks.toastError).toHaveBeenCalledWith(flow.saveError);
        expect(mocks.push).not.toHaveBeenCalled();

        mocks.post.mockResolvedValueOnce({ id: 'saved' });
        await act(async () => { expect(await flow.saveQuestion({ questionText: 'q', subjectId: 'nb-1' })).toBe(true); });
        expect(flow.saveError).toBeNull();
        expect(mocks.push).toHaveBeenCalledWith('/notebooks/nb-1');
    });

    it('每日额度失败保留提示，由 apiClient 统一弹窗，避免重复弹窗', async () => {
        await render();
        mocks.post.mockRejectedValueOnce({ status: 429, data: { message: 'AI_DAILY_LIMIT_EXCEEDED' } });
        await act(async () => { await flow.saveQuestion({ questionText: 'q' }); });
        expect(flow.saveError).toContain(translations.zh.errors.AI_DAILY_LIMIT_EXCEEDED);
        expect(mocks.toastError).not.toHaveBeenCalled();
        await act(async () => flow.dismissSaveError());
        expect(flow.saveError).toBeNull();
    });

    it('文字解题带上错题本，并规范化作答状态', async () => {
        mocks.confirmBeforeImport = true;
        mocks.post.mockResolvedValueOnce({ answerText: '2', analysis: '加法', knowledgePoints: ['加法'], wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'bogus' });
        await render({ textNotebook: { id: 'nb-3', name: '数学' } });

        await act(async () => { await flow.submitText('1 + 1 = ?'); });
        expect(mocks.post).toHaveBeenCalledWith('/api/reanswer', expect.objectContaining({ questionText: '1 + 1 = ?', subject: '数学', subjectId: 'nb-3' }), { timeout: 120000, recoverable: true });
        expect(flow.parsedData).toMatchObject({ questionText: '1 + 1 = ?', mistakeStatus: 'unknown', subject: '其他' });
        expect(flow.currentImage).toBeNull();
    });

    it('上传失败时提示错误并恢复空闲状态', async () => {
        mocks.createImportTask.mockRejectedValueOnce(new Error('boom'));
        await render();
        await act(async () => flow.cropComplete(new Blob(['x'])));
        await act(async () => {});
        expect(mocks.toastError).toHaveBeenCalled();
        expect(flow.analysisStep).toBe('idle');
        expect(mocks.saveParsedQuestion).not.toHaveBeenCalled();
    });
});

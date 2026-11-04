/**
 * 题目导入流程：免确认直接入库、人工校对后保存、文字解题与识别失败提示
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { useQuestionImport } from '@/lib/hooks/use-question-import';
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
vi.mock('@/lib/import/question-import', () => ({
    fetchConfirmBeforeImport: vi.fn(async () => mocks.confirmBeforeImport),
    saveParsedQuestion: mocks.saveParsedQuestion,
}));
const pipeline = vi.hoisted(() => ({
    prepareImage: vi.fn(),
    renderRegion: vi.fn(),
    dispose: vi.fn(),
}));
vi.mock('@/lib/image-pipeline', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/image-pipeline')>()),
    prepareImage: pipeline.prepareImage,
    renderRegion: pipeline.renderRegion,
}));
vi.mock('@/lib/feedback', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/lib/import/import-task-client', () => ({
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
const prepared = { source: {}, width: 4032, height: 3024, format: 'heic', decoder: 'heic', previewUrl: 'blob:preview', sourceType: 'image/heic', sourceBytes: 2_000_000, timings: { read: 12, convert: 800 }, dispose: pipeline.dispose };
const FULL = [{ x: 0, y: 0, width: 1, height: 1 }];
/** 选择照片并确认裁剪 */
async function chooseAndCrop(regions = FULL, multi = false) {
    await act(async () => { await flow.selectImage(new File(['x'], 'photo.heic', { type: 'image/heic' })); });
    await act(async () => { await flow.cropRegions(regions, multi); });
}
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
    pipeline.prepareImage.mockResolvedValue(prepared);
    pipeline.renderRegion.mockResolvedValue({ dataUrl: IMAGE, width: 2364, height: 1773, bytes: 400_000, quality: 0.9, timings: { crop: 30, compress: 120 } });
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

        await chooseAndCrop();
        expect(mocks.createImportTask).toHaveBeenCalledWith(expect.objectContaining({
            imageBase64: IMAGE, subjectId: 'nb-1', targetSubjectId: 'nb-1',
            clientTimings: { read: 12, convert: 800, crop: 30, compress: 120 },
            imageInfo: expect.objectContaining({ sourceType: 'image/heic', sourceWidth: 4032, sourceHeight: 3024, outputWidth: 2364, outputHeight: 1773, decoder: 'heic', quality: 0.9 }),
        }));
        // 裁剪从原图进行
        expect(pipeline.renderRegion).toHaveBeenCalledWith(prepared, FULL[0]);
        expect(flow.analysisStep).toBe('idle');
        await flushTimers();

        expect(flow.pendingTask).toMatchObject({ id: 'task-1', status: 'saved', errorItemId: 'saved', unread: true });
        expect(mocks.markImportTaskRead).not.toHaveBeenCalled();
        expect(flow.step).toBe('upload');
        expect(mocks.post).not.toHaveBeenCalledWith('/api/analyze', expect.anything(), expect.anything());
    });

    it('选好照片后页面重新渲染不会释放解码后的原图，只在离开页面时释放', async () => {
        mocks.createImportTask.mockResolvedValueOnce(task());
        mocks.fetchImportTask.mockResolvedValue(task());
        await render();
        await act(async () => { await flow.selectImage(new File(['x'], 'photo.heic', { type: 'image/heic' })); });
        // 裁剪器打开等状态变化会触发多次重新渲染，此时原图必须保留，裁剪还要从原图绘制
        await render();
        expect(pipeline.dispose).not.toHaveBeenCalled();

        await act(async () => { await flow.cropRegions(FULL, false); });
        expect(pipeline.renderRegion).toHaveBeenCalledWith(prepared, FULL[0]);
        expect(pipeline.dispose).not.toHaveBeenCalled();

        await act(async () => root.unmount());
        expect(pipeline.dispose).toHaveBeenCalledTimes(1);
        root = createRoot(container);
    });

    it('识别中时页面显示任务状态卡，可继续操作', async () => {
        mocks.createImportTask.mockResolvedValueOnce(task());
        mocks.fetchImportTask.mockResolvedValue(task());
        await render();
        await chooseAndCrop();
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

        await chooseAndCrop();
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
        await chooseAndCrop();
        await flushTimers();
        expect(flow.pendingTask?.status).toBe('analyzing');

        // 用户开始裁剪下一张图片时，上一题识别完成
        pipeline.prepareImage.mockResolvedValueOnce({ ...prepared, previewUrl: 'blob:next' });
        await act(async () => { await flow.selectImage(new File(['y'], 'next.jpg', { type: 'image/jpeg' })); });
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
        await chooseAndCrop();
        await act(async () => {});
        expect(mocks.toastError).toHaveBeenCalled();
        expect(flow.analysisStep).toBe('idle');
        expect(mocks.saveParsedQuestion).not.toHaveBeenCalled();
    });

    it('照片无法解码时按原因提示，不打开裁剪', async () => {
        const { ImageDecodeError } = await import('@/lib/image-pipeline');
        pipeline.prepareImage.mockRejectedValueOnce(new ImageDecodeError('HEIC_DECODE_FAILED', 'heic'));
        await render();
        await act(async () => { await flow.selectImage(new File(['x'], 'photo.heic')); });
        expect(mocks.toastError).toHaveBeenCalledWith(translations.zh.upload.decodeErrors.HEIC_DECODE_FAILED);
        expect(flow.isCropperOpen).toBe(false);
        expect(flow.analysisStep).toBe('idle');
    });

    it('多题框选从原图逐框裁剪后进入批量导入', async () => {
        await render();
        const regions = [{ x: 0, y: 0, width: 1, height: 0.5 }, { x: 0, y: 0.5, width: 1, height: 0.5 }];
        await chooseAndCrop(regions, true);
        expect(pipeline.renderRegion).toHaveBeenCalledTimes(2);
        expect(pipeline.renderRegion).toHaveBeenLastCalledWith(prepared, regions[1]);
        expect(flow.batchImages).toHaveLength(2);
        expect(flow.batchImages?.[0]).toMatchObject({ dataUrl: IMAGE, timings: { read: 12, convert: 800, crop: 30, compress: 120 } });
        expect(mocks.createImportTask).not.toHaveBeenCalled();
    });
});

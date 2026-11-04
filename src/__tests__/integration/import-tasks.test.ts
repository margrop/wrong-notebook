// @vitest-environment node
/**
 * 识别导入任务（真实 SQLite）：任务归属、持久恢复、人工校对/自动入库两条路径、重试、重复确认、失败与中断
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    analyzeImage: vi.fn(),
    recognizeGrade: vi.fn(),
    failNextSave: false,
    crashAfterWrite: false,
    saveGate: null as Promise<void> | null,
    session: { user: { id: 'user-1', email: 'import-task@example.com', role: 'user' }, expires: '2099-01-01' } as {
        user: { id: string; email: string; role: string };
        expires: string;
    },
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai', () => ({ getAIService: () => ({ analyzeImage: mocks.analyzeImage, recognizeGrade: mocks.recognizeGrade }) }));
vi.mock('@/lib/ai/tag-service', () => ({ getNotebookCandidateTags: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/mastery', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mastery')>()),
    scheduleMasteryEvaluation: vi.fn(),
}));
vi.mock('@/lib/question/question-save', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/question/question-save')>();
    return {
        ...original,
        saveQuestion: vi.fn(async (...[user, body, options]: Parameters<typeof original.saveQuestion>) => {
            if (mocks.saveGate) await mocks.saveGate;
            if (mocks.failNextSave) {
                mocks.failNextSave = false;
                return {
                    ok: false,
                    error: {
                        code: 'QUESTION_SAVE_DATABASE_BUSY',
                        stage: 'save',
                        status: 503,
                        errorCode: 'DATABASE_ERROR',
                    },
                };
            }
            if (mocks.crashAfterWrite) {
                mocks.crashAfterWrite = false;
                // 模拟错题已写入、任务关联也已执行，但提交前进程崩溃
                return original.saveQuestion(user, body, {
                    afterWrite: async (tx, saved) => {
                        await options?.afterWrite?.(tx, saved);
                        throw new Error('SIMULATED_CRASH');
                    },
                });
            }
            return original.saveQuestion(user, body, options);
        }),
    };
});

import { GET as LIST, POST as CREATE } from '@/app/api/import-tasks/route';
import { DELETE as DISCARD, GET as GET_TASK } from '@/app/api/import-tasks/[id]/route';
import { POST as CONFIRM } from '@/app/api/import-tasks/[id]/confirm/route';
import { POST as RETRY } from '@/app/api/import-tasks/[id]/retry/route';
import { POST as READ } from '@/app/api/import-tasks/[id]/read/route';
import { simulateRestartForTest, waitForImportTaskForTest } from '@/lib/import/import-tasks';

let database: PrismaClient;
let directory: string;
let sequence = 0;
const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';
const parsed = (questionText = '求解方程 x + 2 = 5') => ({
    questionText,
    answerText: 'x = 3',
    analysis: '移项得 x = 3',
    knowledgePoints: ['一元一次方程'],
    subject: '数学',
    mistakeStatus: 'unknown',
    wrongAnswerText: '',
    mistakeAnalysis: '',
    requiresImage: false,
});

const json = (body: unknown, method = 'POST') => new Request('http://localhost/api/import-tasks', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const asUser = (id: 'user-1' | 'user-2') => {
    mocks.session = { user: { id, email: id === 'user-1' ? 'import-task@example.com' : 'other@example.com', role: 'user' }, expires: '2099-01-01' };
};

async function create(body: Record<string, unknown> = {}) {
    const response = await CREATE(json({ clientRequestId: `request-${++sequence}-abcdef`, imageBase64: IMAGE, language: 'zh', ...body }));
    const data = await response.json();
    return { response, task: data.task, data };
}
async function getTask(id: string, image = false) {
    const response = await GET_TASK(new Request(`http://localhost/api/import-tasks/${id}${image ? '?include=image' : ''}`), params(id));
    return { response, task: (await response.json()).task };
}
const confirm = (id: string, body: Record<string, unknown> = {}) => CONFIRM(json({ ...parsed(), subjectId: 'math', ...body }), params(id));

beforeAll(async () => {
    // 只使用系统临时数据库，不接触开发或生产数据
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-import-task-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    await database.$queryRaw`PRAGMA journal_mode = WAL`;
    await database.$queryRaw`PRAGMA busy_timeout = 30000`;
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    asUser('user-1');
    mocks.failNextSave = false;
    mocks.crashAfterWrite = false;
    mocks.saveGate = null;
    mocks.analyzeImage.mockReset();
    mocks.analyzeImage.mockResolvedValue(parsed());
    mocks.recognizeGrade.mockResolvedValue(null);
    await database.user.deleteMany();
    await database.user.createMany({ data: [
        { id: 'user-1', email: 'import-task@example.com', password: 'test-only', confirmBeforeImport: true },
        { id: 'user-2', email: 'other@example.com', password: 'test-only' },
    ] });
    await database.subject.createMany({ data: [
        { id: 'math', name: '数学', userId: 'user-1' },
        { id: 'physics', name: '物理', userId: 'user-1' },
        { id: 'other-math', name: '数学', userId: 'user-2' },
    ] });
}, 30000);

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('识别导入任务', () => {
    it('人工校对：上传后立即返回任务编号，识别结果持久保存为待校对草稿，确认后入库一次', async () => {
        const { response, task } = await create({ subjectId: 'math', clientTimings: { compress: 120, read: 5 }, imageInfo: { sourceType: 'image/heic', decoder: 'heic', outputWidth: 1600, outputHeight: 1200, outputBytes: 300000 } });
        expect(response.status).toBe(202);
        expect(task).toMatchObject({ status: 'analyzing', mode: 'review' });
        await waitForImportTaskForTest(task.id);

        const stored = await getTask(task.id, true);
        expect(stored.task).toMatchObject({ status: 'review', unread: true, hasResult: true, imageData: IMAGE });
        expect(stored.task.result.questionText).toBe('求解方程 x + 2 = 5');
        expect(stored.task.timings.client).toMatchObject({ compress: 120, read: 5 });
        expect(stored.task.timings.server.analyze).toEqual(expect.any(Number));
        expect(await database.errorItem.count()).toBe(0);

        const saved = await confirm(task.id, { questionText: '校对后的题目：求解 x + 2 = 5' });
        expect(saved.status).toBe(201);
        const body = await saved.json();
        expect(body.importTask).toMatchObject({ status: 'saved', errorItemId: body.id, notebookName: '数学' });
        const item = await database.errorItem.findUniqueOrThrow({ where: { id: body.id } });
        expect(item).toMatchObject({ questionText: '校对后的题目：求解 x + 2 = 5', originalImageUrl: IMAGE, subjectId: 'math', userId: 'user-1' });

        // 重复确认：返回原结果，不重复入库
        const again = await confirm(task.id);
        expect(again.status).toBe(200);
        expect(await again.json()).toMatchObject({ id: body.id, alreadySaved: true });
        expect(await database.errorItem.count()).toBe(1);
        // 入库后清空任务中的图片，原图保存在错题中
        expect((await database.importTask.findUniqueOrThrow({ where: { id: task.id } })).imageData).toBe('');
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(1);
    });

    it('并发重复确认只入库一次', async () => {
        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        const responses = await Promise.all([confirm(task.id), confirm(task.id), confirm(task.id)]);
        const statuses = responses.map((response) => response.status).sort();
        expect(statuses.filter((status) => status === 201)).toHaveLength(1);
        expect(statuses.every((status) => [200, 201, 409].includes(status))).toBe(true);
        for (const response of responses.filter((item) => item.status === 200)) {
            expect(await response.json()).toMatchObject({ alreadySaved: true });
        }
        expect(await database.errorItem.count()).toBe(1);
        // 没有走到判重（判重会额外记一次做错记录），说明只执行了一次保存
        expect(await database.practiceRecord.count()).toBe(0);
    });

    it('从错题本添加页发起的任务固定放入该错题本，不能改到其他或别人的错题本', async () => {
        const { task } = await create({ subjectId: 'math', targetSubjectId: 'math' });
        await waitForImportTaskForTest(task.id);
        const saved = await (await confirm(task.id, { subjectId: 'physics' })).json();
        expect((await database.errorItem.findUniqueOrThrow({ where: { id: saved.id } })).subjectId).toBe('math');

        const other = await create({ targetSubjectId: 'other-math' });
        expect(other.response.status).toBe(400);
        expect(other.data.message).toBe('IMPORT_TASK_INVALID_NOTEBOOK');
    });

    it('自动入库：关闭人工确认时服务端识别后直接保存，复用判重规则', async () => {
        await database.user.update({ where: { id: 'user-1' }, data: { confirmBeforeImport: false } });
        const first = await create();
        expect(first.task.mode).toBe('auto');
        await waitForImportTaskForTest(first.task.id);
        const saved = (await getTask(first.task.id)).task;
        expect(saved).toMatchObject({ status: 'saved', duplicate: false, unread: true, notebookName: '数学' });
        expect(saved.errorItemShortId).toEqual(expect.any(String));
        expect((await database.errorItem.findUniqueOrThrow({ where: { id: saved.errorItemId } })).originalImageUrl).toBe(IMAGE);

        // 相同题目再次导入：判为重复题，记录做错历史，不新增错题
        const second = await create();
        await waitForImportTaskForTest(second.task.id);
        expect((await getTask(second.task.id)).task).toMatchObject({ status: 'saved', duplicate: true, errorItemId: saved.errorItemId });
        expect(await database.errorItem.count()).toBe(1);
        expect(await database.practiceRecord.count({ where: { source: 'duplicate_import' } })).toBe(1);
    });

    it('批量框选强制直接入库，即使开启了人工确认', async () => {
        const { task } = await create({ mode: 'auto', targetSubjectId: 'physics' });
        await waitForImportTaskForTest(task.id);
        const stored = (await getTask(task.id)).task;
        expect(stored).toMatchObject({ mode: 'auto', status: 'saved', notebookName: '物理' });
    });

    it('同一请求编号重复提交返回同一任务，不重复识别', async () => {
        const body = { clientRequestId: 'same-request-123456', imageBase64: IMAGE };
        const first = await CREATE(json(body));
        const second = await CREATE(json(body));
        expect(first.status).toBe(202);
        expect(second.status).toBe(200);
        const [a, b] = [await first.json(), await second.json()];
        expect(b.task.id).toBe(a.task.id);
        await waitForImportTaskForTest(a.task.id);
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(1);
        expect(await database.importTask.count()).toBe(1);
    });

    it('任务严格按用户隔离', async () => {
        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        asUser('user-2');
        expect((await getTask(task.id)).response.status).toBe(404);
        expect((await confirm(task.id, { subjectId: null })).status).toBe(404);
        expect((await RETRY(json({}), params(task.id))).status).toBe(404);
        expect((await READ(json({}), params(task.id))).status).toBe(404);
        expect((await DISCARD(json({}, 'DELETE'), params(task.id))).status).toBe(404);
        expect((await (await LIST()).json()).tasks).toEqual([]);
        // 其他用户使用相同请求编号不会拿到别人的任务
        const own = await CREATE(json({ clientRequestId: (await database.importTask.findUniqueOrThrow({ where: { id: task.id } })).clientRequestId, imageBase64: IMAGE }));
        expect(own.status).toBe(202);
        const ownTask = (await own.json()).task;
        expect(ownTask.id).not.toBe(task.id);
        // 等待该任务的后台识别结束，避免调用计入下一个用例
        await waitForImportTaskForTest(ownTask.id);
        asUser('user-1');
        expect((await getTask(task.id)).task.status).toBe('review');
    });

    it('识别失败标记失败并给出错误码，重试时重新识别', async () => {
        mocks.analyzeImage.mockRejectedValueOnce(new Error('AI_TIMEOUT_ERROR'));
        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        expect((await getTask(task.id)).task).toMatchObject({ status: 'failed', error: 'AI_TIMEOUT_ERROR', hasResult: false, unread: true });

        const retried = await RETRY(json({}), params(task.id));
        expect(retried.status).toBe(202);
        await waitForImportTaskForTest(task.id);
        expect((await getTask(task.id)).task).toMatchObject({ status: 'review', error: null, attempts: 2 });
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(2);
        // 不是失败状态时不能重试
        expect((await RETRY(json({}), params(task.id))).status).toBe(409);
    });

    it('自动入库保存失败时保留识别结果，重试只重新保存，不再调用 AI', async () => {
        await database.user.update({ where: { id: 'user-1' }, data: { confirmBeforeImport: false } });
        mocks.failNextSave = true;
        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        expect((await getTask(task.id)).task).toMatchObject({ status: 'failed', error: 'QUESTION_SAVE_DATABASE_BUSY', hasResult: true });

        expect((await RETRY(json({}), params(task.id))).status).toBe(202);
        await waitForImportTaskForTest(task.id);
        expect((await getTask(task.id)).task).toMatchObject({ status: 'saved', attempts: 2 });
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(1);
        expect(await database.errorItem.count()).toBe(1);
    });

    it('校对确认保存失败时退回待校对，草稿不丢失', async () => {
        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        mocks.failNextSave = true;
        const failed = await confirm(task.id);
        expect(failed.status).toBe(503);
        expect((await getTask(task.id)).task).toMatchObject({ status: 'review', error: 'QUESTION_SAVE_DATABASE_BUSY', hasResult: true });
        expect((await confirm(task.id)).status).toBe(201);
    });

    it('服务重启：已完成的结果仍可打开，执行中的任务准确标记为中断，可重试', async () => {
        const done = await create();
        await waitForImportTaskForTest(done.task.id);
        // 模拟识别一直未返回时服务重启
        mocks.analyzeImage.mockImplementationOnce(() => new Promise(() => undefined));
        const pending = await create();
        expect((await getTask(pending.task.id)).task.status).toBe('analyzing');

        simulateRestartForTest();
        const list = await (await LIST()).json();
        const byId = Object.fromEntries(list.tasks.map((task: { id: string }) => [task.id, task]));
        expect(byId[pending.task.id]).toMatchObject({ status: 'failed', error: 'SERVER_RESTARTED' });
        expect(list.activeCount).toBe(0);
        const recovered = (await getTask(done.task.id, true)).task;
        expect(recovered).toMatchObject({ status: 'review', imageData: IMAGE });
        expect(recovered.result.questionText).toBe('求解方程 x + 2 = 5');
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(2);

        expect((await RETRY(json({}), params(pending.task.id))).status).toBe(202);
        await waitForImportTaskForTest(pending.task.id);
        expect((await getTask(pending.task.id)).task.status).toBe('review');
    });

    it('未读提示、列表计数、丢弃', async () => {
        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        let list = await (await LIST()).json();
        expect(list).toMatchObject({ unreadCount: 1, activeCount: 0 });
        expect(list.tasks[0]).not.toHaveProperty('imageData');
        expect((await READ(json({}), params(task.id))).status).toBe(200);
        list = await (await LIST()).json();
        expect(list.unreadCount).toBe(0);
        expect((await DISCARD(json({}, 'DELETE'), params(task.id))).status).toBe(200);
        expect((await getTask(task.id)).response.status).toBe(404);
    });

    it('待校对任务不会按 30 分钟过期，已保存任务超过保留期后清理', async () => {
        const review = await create();
        await waitForImportTaskForTest(review.task.id);
        const saved = await create();
        await waitForImportTaskForTest(saved.task.id);
        await confirm(saved.task.id);
        const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await database.importTask.updateMany({ data: { createdAt: old, finishedAt: old } });
        const ids = (await (await LIST()).json()).tasks.map((task: { id: string }) => task.id);
        expect(ids).toEqual([review.task.id]);
    });

    it('拒绝非图片或非法的上传内容', async () => {
        expect((await create({ imageBase64: 'data:image/heic;base64,AAAA' })).response.status).toBe(400);
        expect((await create({ imageBase64: 'not-a-data-url' })).response.status).toBe(400);
        expect((await CREATE(json({ imageBase64: IMAGE }))).status).toBe(400);
        expect(await database.importTask.count()).toBe(0);
    });

    it('并发确认时保存挂起：失败的抢占请求不会移除获胜者的执行登记，查询不会误判为中断', async () => {
        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        let open!: () => void;
        mocks.saveGate = new Promise<void>((resolve) => { open = resolve; });
        let settled = 0;
        const pending = [confirm(task.id), confirm(task.id), confirm(task.id)].map((promise) => promise.then((response) => { settled++; return response; }));
        for (let i = 0; i < 200 && settled < 2; i++) await new Promise((resolve) => setTimeout(resolve, 10));
        expect(settled).toBe(2);
        expect((await getTask(task.id)).task.status).toBe('saving');
        expect((await (await LIST()).json()).activeCount).toBe(1);
        open();
        const responses = await Promise.all(pending);
        expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
        expect((await getTask(task.id)).task.status).toBe('saved');
        expect(await database.errorItem.count()).toBe(1);
    });

    it('错题写入与任务关联在同一事务：提交前崩溃整笔回滚，重试后只入库一次', async () => {
        await database.user.update({ where: { id: 'user-1' }, data: { confirmBeforeImport: false } });
        mocks.crashAfterWrite = true;
        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        expect((await getTask(task.id)).task).toMatchObject({ status: 'failed', errorItemId: null, hasResult: true });
        expect(await database.errorItem.count()).toBe(0);

        expect((await RETRY(json({}), params(task.id))).status).toBe(202);
        await waitForImportTaskForTest(task.id);
        const saved = (await getTask(task.id)).task;
        expect(saved).toMatchObject({ status: 'saved', duplicate: false });
        expect(await database.errorItem.count()).toBe(1);
        expect(await database.practiceRecord.count()).toBe(0);

        // 已提交的保存在重启后仍为已保存，不能再次重试
        simulateRestartForTest();
        expect((await getTask(task.id)).task).toMatchObject({ status: 'saved', errorItemId: saved.errorItemId });
        expect((await RETRY(json({}), params(task.id))).status).toBe(409);
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(1);
    });

    it('重复题的做错记录同样随任务关联回滚', async () => {
        await database.errorItem.create({ data: { userId: 'user-1', subjectId: 'math', questionText: '求解方程 x + 2 = 5', originalImageUrl: '' } });
        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        mocks.crashAfterWrite = true;
        expect((await confirm(task.id)).status).toBe(500);
        expect(await database.practiceRecord.count()).toBe(0);
        expect((await getTask(task.id)).task.status).toBe('review');
        expect((await confirm(task.id)).status).toBe(200);
        expect(await database.practiceRecord.count()).toBe(1);
        expect(await database.errorItem.count()).toBe(1);
    });

    it('额度只由实际执行识别的请求计一次', async () => {
        const body = { clientRequestId: 'concurrent-request-1', imageBase64: IMAGE };
        const responses = await Promise.all([CREATE(json(body)), CREATE(json(body)), CREATE(json(body))]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 202]);
        const id = (await responses[0].json()).task.id;
        await waitForImportTaskForTest(id);
        expect(await database.aiUsage.count({ where: { userId: 'user-1', kind: 'analyze' } })).toBe(1);
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(1);

        // 识别失败后并发重试：只重新识别一次、计一次额度
        await database.importTask.update({ where: { id }, data: { status: 'failed', result: null, error: 'AI_TIMEOUT_ERROR' } });
        // 识别保持进行中，直到两个重试都已返回，保证两次请求确实重叠（慢机器上第一个重试不会在第二个到达前就结束）
        let releaseRetry: () => void = () => undefined;
        const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
        mocks.analyzeImage.mockImplementationOnce(async () => { await retryGate; return parsed(); });
        const retries = await Promise.all([RETRY(json({}), params(id)), RETRY(json({}), params(id))]);
        expect(retries.map((response) => response.status).sort()).toEqual([200, 202]);
        releaseRetry();
        await waitForImportTaskForTest(id);
        expect(await database.aiUsage.count({ where: { userId: 'user-1', kind: 'analyze' } })).toBe(2);
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(2);

        // 先后到达的重复重试（第一个已抢占并在识别中）同样返回当前任务，不再识别、不计额度
        await database.importTask.update({ where: { id }, data: { status: 'failed', result: null, error: 'AI_TIMEOUT_ERROR' } });
        let releaseAnalysis: () => void = () => undefined;
        const analysisGate = new Promise<void>((resolve) => { releaseAnalysis = resolve; });
        mocks.analyzeImage.mockImplementationOnce(async () => { await analysisGate; return parsed(); });
        expect((await RETRY(json({}), params(id))).status).toBe(202);
        const late = await RETRY(json({}), params(id));
        expect(late.status).toBe(200);
        expect((await late.json()).task.status).toBe('analyzing');
        releaseAnalysis();
        await waitForImportTaskForTest(id);
        expect(await database.aiUsage.count({ where: { userId: 'user-1', kind: 'analyze' } })).toBe(3);
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(3);
    });

    it('拒绝非法状态迁移，确认时不接受前端替换图片', async () => {
        mocks.analyzeImage.mockImplementationOnce(() => new Promise(() => undefined));
        const pending = await create();
        expect((await confirm(pending.task.id)).status).toBe(409);
        expect((await RETRY(json({}), params(pending.task.id))).status).toBe(409);

        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        expect((await RETRY(json({}), params(task.id))).status).toBe(409);
        const saved = await (await confirm(task.id, { originalImageUrl: 'data:image/png;base64,ZXZpbA==' })).json();
        expect((await database.errorItem.findUniqueOrThrow({ where: { id: saved.id } })).originalImageUrl).toBe(IMAGE);
        simulateRestartForTest();
    });

    it('状态响应不含题目图片：创建、识别中、待校对轮询都很小，校对页按需取一次图片', async () => {
        // 约 2MB 的图片
        const large = `data:image/jpeg;base64,/9j/${'A'.repeat(2 * 1024 * 1024)}`;
        mocks.analyzeImage.mockImplementationOnce(() => new Promise(() => undefined));
        const pending = await CREATE(json({ clientRequestId: 'large-image-pending', imageBase64: large }));
        const pendingText = await pending.text();
        expect(pending.status).toBe(202);
        expect(pendingText.length).toBeLessThan(4096);
        expect(JSON.parse(pendingText).task.imageData).toBeNull();
        const polling = await GET_TASK(new Request(`http://localhost/api/import-tasks/${JSON.parse(pendingText).task.id}`), params(JSON.parse(pendingText).task.id));
        const pollingText = await polling.text();
        expect(JSON.parse(pollingText).task).toMatchObject({ status: 'analyzing', imageData: null });
        expect(pollingText.length).toBeLessThan(4096);

        const done = await CREATE(json({ clientRequestId: 'large-image-review', imageBase64: large }));
        const id = (await done.json()).task.id;
        await waitForImportTaskForTest(id);
        const review = await GET_TASK(new Request(`http://localhost/api/import-tasks/${id}`), params(id));
        const reviewText = await review.text();
        expect(JSON.parse(reviewText).task).toMatchObject({ status: 'review', imageData: null, hasResult: true });
        expect(reviewText.length).toBeLessThan(4096);
        const withImage = await GET_TASK(new Request(`http://localhost/api/import-tasks/${id}?include=image`), params(id));
        expect((await withImage.json()).task.imageData).toBe(large);
        const list = await (await LIST()).text();
        expect(list.length).toBeLessThan(8192);
        // 后台入库仍使用服务端保存的原图
        expect((await confirm(id)).status).toBe(201);
        const task = await database.importTask.findUniqueOrThrow({ where: { id } });
        expect((await database.errorItem.findUniqueOrThrow({ where: { id: task.errorItemId! } })).originalImageUrl).toBe(large);
        simulateRestartForTest();
    });

    it('已保存任务的错题被删除后，任务仍可查询且不再指向错题，不能重试', async () => {
        const { task } = await create();
        await waitForImportTaskForTest(task.id);
        const saved = await (await confirm(task.id)).json();
        await database.errorItem.delete({ where: { id: saved.id } });
        const { response, task: current } = await getTask(task.id);
        expect(response.status).toBe(200);
        expect(current).toMatchObject({ status: 'saved', errorItemId: null, errorItemShortId: null });
        expect((await RETRY(json({}), params(task.id))).status).toBe(409);
        expect((await confirm(task.id)).status).toBe(409);
    });
});

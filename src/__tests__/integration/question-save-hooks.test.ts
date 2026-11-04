// @vitest-environment node
/**
 * 题目保存全局钩子（真实 SQLite）：注册/清理、调用参数、duplicate 场景、
 * 钩子抛错整笔回滚、单题保存与识别导入任务两条路径的 origin 传递。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    analyzeImage: vi.fn(),
    recognizeGrade: vi.fn(),
    session: { user: { id: 'user-1', email: 'hook-test@example.com', role: 'user' }, expires: '2099-01-01' } as {
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

import { POST as SAVE_QUESTION } from '@/app/api/error-items/route';
import { POST as CREATE_TASK } from '@/app/api/import-tasks/route';
import { POST as CONFIRM_TASK } from '@/app/api/import-tasks/[id]/confirm/route';
import { waitForImportTaskForTest } from '@/lib/import/import-tasks';
import { QUESTION_SAVE_HOOKS, clearQuestionSaveHooksForTest, registerQuestionSaveHook } from '@/lib/question/question-save-hooks';
import type { QuestionSaveEvent } from '@/lib/question/question-save-hooks';
import { saveQuestion } from '@/lib/question/question-save';
import type { User } from '@prisma/client';

let database: PrismaClient;
let directory: string;
let sequence = 0;
const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';
const questionText = '钩子测试：求解方程 x + 2 = 5';

const saveRequest = (body: Record<string, unknown>) => new Request('http://localhost/api/error-items', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-save-hook-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    const { PrismaClient } = await import('@prisma/client');
    database = new PrismaClient({ datasources: { db: { url } } });
    await database.$queryRaw`PRAGMA journal_mode = WAL`;
    await database.$queryRaw`PRAGMA busy_timeout = 30000`;
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    clearQuestionSaveHooksForTest();
    mocks.analyzeImage.mockReset();
    mocks.recognizeGrade.mockReset();
    mocks.recognizeGrade.mockResolvedValue(null);
    await database.user.deleteMany();
    await database.user.create({ data: { id: 'user-1', email: 'hook-test@example.com', password: 'test-only', confirmBeforeImport: true } });
    await database.subject.createMany({ data: [
        { id: 'math', name: '数学', userId: 'user-1' },
    ] });
});

afterAll(async () => {
    clearQuestionSaveHooksForTest();
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

function captureEvents(): QuestionSaveEvent[] {
    const events: QuestionSaveEvent[] = [];
    registerQuestionSaveHook(async (_tx, event) => { events.push(event); });
    return events;
}

describe('题目保存全局钩子', () => {
    it('注册表初始为空，注册后可取消注册，测试清理函数清空全部', () => {
        expect(QUESTION_SAVE_HOOKS).toHaveLength(0);
        const hook = vi.fn();
        const unregister = registerQuestionSaveHook(hook);
        expect(QUESTION_SAVE_HOOKS).toHaveLength(1);
        unregister();
        expect(QUESTION_SAVE_HOOKS).toHaveLength(0);
        registerQuestionSaveHook(hook);
        registerQuestionSaveHook(hook);
        expect(QUESTION_SAVE_HOOKS).toHaveLength(2);
        clearQuestionSaveHooksForTest();
        expect(QUESTION_SAVE_HOOKS).toHaveLength(0);
    });

    it('单题保存 API：钩子在同一事务内收到 userId/errorItemId/duplicate=false/origin=manual/input', async () => {
        mocks.analyzeImage.mockResolvedValue({ questionText, answerText: 'x=3', analysis: '移项得 x = 3', knowledgePoints: [], subject: '数学', requiresImage: false, wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'unknown', gradeSemester: null });
        const events = captureEvents();
        const response = await SAVE_QUESTION(saveRequest({ questionText, subjectId: 'math', originalImageUrl: '' }));
        expect(response.status).toBe(201);
        const body = await response.json() as { id: string };
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            userId: 'user-1',
            errorItemId: body.id,
            duplicate: false,
            origin: 'manual',
        });
        expect(events[0].input.questionText).toBe(questionText);
        expect(await database.errorItem.count()).toBe(1);
    });

    it('saveQuestion 直接调用缺省 origin 为 manual', async () => {
        const events = captureEvents();
        const user = await database.user.findUniqueOrThrow({ where: { id: 'user-1' } });
        const { importSchema } = await import('@/lib/question/question-save');
        const body = importSchema.parse({ questionText, originalImageUrl: '', subjectId: 'math' });
        const result = await saveQuestion(user as User, body);
        expect(result.ok).toBe(true);
        expect(events).toHaveLength(1);
        expect(events[0].origin).toBe('manual');
    });

    it('识别导入任务：自动入库与校对确认路径钩子均收到 origin=import-task', async () => {
        await database.user.update({ where: { id: 'user-1' }, data: { confirmBeforeImport: false } });
        mocks.analyzeImage.mockResolvedValue({ questionText, answerText: 'x=3', analysis: '移项得 x = 3', knowledgePoints: [], subject: '数学', requiresImage: false, wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'unknown', gradeSemester: null });
        const events = captureEvents();

        const auto = await CREATE_TASK(new Request('http://localhost/api/import-tasks', {
            method: 'POST',
            body: JSON.stringify({ clientRequestId: `auto-${++sequence}-abcdef`, imageBase64: IMAGE, language: 'zh' }),
            headers: { 'Content-Type': 'application/json' },
        }));
        expect(auto.status).toBe(202);
        const autoTask = (await auto.json() as { task: { id: string } }).task;
        await waitForImportTaskForTest(autoTask.id);

        expect(events).toHaveLength(1);
        expect(events[0].origin).toBe('import-task');
        expect(events[0].duplicate).toBe(false);
        const autoItem = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1' } });
        expect(events[0].errorItemId).toBe(autoItem.id);

        // 校对确认路径
        await database.user.update({ where: { id: 'user-1' }, data: { confirmBeforeImport: true } });
        const review = await CREATE_TASK(new Request('http://localhost/api/import-tasks', {
            method: 'POST',
            body: JSON.stringify({ clientRequestId: `review-${++sequence}-abcdef`, imageBase64: IMAGE, language: 'zh' }),
            headers: { 'Content-Type': 'application/json' },
        }));
        const reviewTask = (await review.json() as { task: { id: string } }).task;
        await waitForImportTaskForTest(reviewTask.id);

        const confirm = await CONFIRM_TASK(
            new Request(`http://localhost/api/import-tasks/${reviewTask.id}/confirm`, {
                method: 'POST',
                body: JSON.stringify({ questionText: `${questionText}（校对版）`, subjectId: 'math' }),
                headers: { 'Content-Type': 'application/json' },
            }),
            { params: Promise.resolve({ id: reviewTask.id }) },
        );
        expect(confirm.status).toBe(201);

        expect(events).toHaveLength(2);
        expect(events[1].origin).toBe('import-task');
        expect(events[1].duplicate).toBe(false);
    });

    it('重复题场景：钩子收到 duplicate=true 且 errorItemId 指向原题', async () => {
        const events = captureEvents();
        // 第一次保存
        const first = await SAVE_QUESTION(saveRequest({ questionText, subjectId: 'math', originalImageUrl: '' }));
        expect(first.status).toBe(201);
        const firstId = (await first.json() as { id: string }).id;

        // 第二次保存相同题目 → 判重
        const second = await SAVE_QUESTION(saveRequest({ questionText, subjectId: 'math', originalImageUrl: '' }));
        expect(second.status).toBe(200);

        expect(events).toHaveLength(2);
        expect(events[0].duplicate).toBe(false);
        expect(events[1].duplicate).toBe(true);
        expect(events[1].errorItemId).toBe(firstId);
        // 只创建了一道错题
        expect(await database.errorItem.count()).toBe(1);
    });

    it('钩子抛错时整笔事务回滚：错题不落库，返回失败', async () => {
        registerQuestionSaveHook(async (tx, event) => {
            await tx.errorItem.update({ where: { id: event.errorItemId }, data: { questionText: '钩子写入' } });
            throw new Error('HOOK_SIMULATED_FAILURE');
        });
        const response = await SAVE_QUESTION(saveRequest({ questionText, subjectId: 'math', originalImageUrl: '' }));
        // saveQuestion 内部捕获错误并返回分类后的失败结果，HTTP 层转换为 500
        expect(response.status).toBe(500);
        // 整笔回滚：错题未落库
        expect(await database.errorItem.count()).toBe(0);
    });

    it('afterWrite 之后执行钩子：钩子里能看到 afterWrite 写入的关联数据', async () => {
        const seen: Array<{ taskStatus: string | null }> = [];
        registerQuestionSaveHook(async (tx, event) => {
            const task = await tx.importTask.findFirst({ where: { errorItemId: event.errorItemId } });
            seen.push({ taskStatus: task?.status ?? null });
        });

        await database.user.update({ where: { id: 'user-1' }, data: { confirmBeforeImport: false } });
        mocks.analyzeImage.mockResolvedValue({ questionText, answerText: 'x=3', analysis: '移项得 x = 3', knowledgePoints: [], subject: '数学', requiresImage: false, wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'unknown', gradeSemester: null });
        const created = await CREATE_TASK(new Request('http://localhost/api/import-tasks', {
            method: 'POST',
            body: JSON.stringify({ clientRequestId: `order-${++sequence}-abcdef`, imageBase64: IMAGE, language: 'zh' }),
            headers: { 'Content-Type': 'application/json' },
        }));
        const taskId = (await created.json() as { task: { id: string } }).task.id;
        await waitForImportTaskForTest(taskId);

        expect(seen).toEqual([{ taskStatus: 'saved' }]);
    });
});

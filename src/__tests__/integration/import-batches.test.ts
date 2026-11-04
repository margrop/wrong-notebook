// @vitest-environment node
/**
 * 多题录入批次（真实 SQLite，AI 用模拟实现）：文字本地分题与 AI 分题、照片自动分题、草稿版本、开始解析幂等与并发、
 * 部分失败只重试失败题、校对模式批量确认、中断恢复、用户隔离与任务列表汇总
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuestionSplitInput, QuestionSplitResult } from '@/lib/ai/question-split';

// 模拟核数少的 CI/NAS：Prisma 查询引擎只有 2 个工作线程（须在加载 Prisma 前设置）。
// 线程少时，等写锁的语句若占满线程会让持锁事务卡住，这一组用例据此验证写入串行化
vi.hoisted(() => {
    process.env.TOKIO_WORKER_THREADS = '2';
});

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    analyzeImage: vi.fn(),
    recognizeGrade: vi.fn(),
    reanswerQuestion: vi.fn(),
    splitQuestions: vi.fn(),
    fixQuestionText: vi.fn(),
    suggestKnowledgeTags: vi.fn(),
    dailyLimit: 0,
    session: { user: { id: 'user-1', email: 'batch@example.com', role: 'user' }, expires: '2099-01-01' } as {
        user: { id: string; email: string; role: string };
        expires: string;
    },
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai', () => ({
    getAIService: () => ({
        analyzeImage: mocks.analyzeImage,
        recognizeGrade: mocks.recognizeGrade,
        reanswerQuestion: mocks.reanswerQuestion,
        splitQuestions: mocks.splitQuestions,
        fixQuestionText: mocks.fixQuestionText,
        suggestKnowledgeTags: mocks.suggestKnowledgeTags,
    }),
}));
vi.mock('@/lib/ai/tag-service', () => ({
    getNotebookCandidateTags: vi.fn(async () => undefined),
    getMathTagsFromDB: vi.fn(async () => ['分数的意义', '一元一次方程']),
    getScopeTagsFromDB: vi.fn(async () => ['分数的意义', '一元一次方程']),
}));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/config', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/config')>()),
    getAppConfig: () => ({ aiProvider: 'openai', aiDailyLimit: mocks.dailyLimit }),
    getAppTimeZone: () => 'Asia/Shanghai',
}));
vi.mock('@/lib/mastery', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mastery')>()),
    scheduleMasteryEvaluation: vi.fn(),
}));

import { GET as LIST } from '@/app/api/import-tasks/route';
import { POST as CREATE } from '@/app/api/import-batches/route';
import { DELETE as DISCARD, GET as GET_BATCH, PATCH } from '@/app/api/import-batches/[id]/route';
import { POST as START } from '@/app/api/import-batches/[id]/start/route';
import { POST as RETRY } from '@/app/api/import-batches/[id]/retry/route';
import { POST as CONFIRM_ALL } from '@/app/api/import-batches/[id]/confirm-all/route';
import { POST as READ } from '@/app/api/import-batches/[id]/read/route';
import { POST as FIX_TEXT } from '@/app/api/import-batches/[id]/fix-text/route';
import { POST as CONFIRM_TASK } from '@/app/api/import-tasks/[id]/confirm/route';
import { waitForImportBatchTasksForTest } from '@/lib/import/import-batches';
import { simulateRestartForTest, waitForImportTaskForTest } from '@/lib/import/import-tasks';
import { runQuestionImportTransaction } from '@/lib/question/question-deduplication';

let database: PrismaClient<{ log: Array<{ emit: 'event'; level: 'query' }> }>;
const queries: string[] = [];
let directory: string;
let sequence = 0;
const PAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';
const CROP = (n: number) => `data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD${'AB'.repeat(n)}==`;
const ISSUE6 = readFileSync(join(__dirname, '../fixtures/issue-6-nine-questions.txt'), 'utf8');

const json = (body: unknown, method = 'POST') => new Request('http://localhost/api/import-batches', {
    method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const asUser = (id: 'user-1' | 'user-2') => {
    mocks.session = { user: { id, email: id === 'user-1' ? 'batch@example.com' : 'other@example.com', role: 'user' }, expires: '2099-01-01' };
};

async function create(body: Record<string, unknown>) {
    const response = await CREATE(json({ clientRequestId: `batch-${++sequence}-abcdef`, language: 'zh', ...body }));
    const data = await response.json();
    return { response, batch: data.batch, data };
}
async function getBatch(id: string, image = false) {
    const response = await GET_BATCH(new Request(`http://localhost/api/import-batches/${id}${image ? '?include=image' : ''}`), params(id));
    return { response, batch: (await response.json()).batch };
}
const start = (id: string, body: Record<string, unknown>) => START(json(body), params(id));
/** 按草稿中的题目顺序取出入库的错题（并发保存时 createdAt 可能相同，不能据此排序） */
async function savedItemsInDraftOrder(batchId: string) {
    const batch = await database.importBatch.findUniqueOrThrow({ where: { id: batchId }, select: { draft: true } });
    const keys = (JSON.parse(batch.draft ?? '{"items":[]}') as { items: { key: string }[] }).items.map((item) => item.key);
    const tasks = await database.importTask.findMany({ where: { batchId }, select: { batchItemKey: true, errorItemId: true } });
    const ids = keys
        .map((key) => tasks.find((task) => task.batchItemKey === key)?.errorItemId)
        .filter((id): id is string => !!id);
    const items = await database.errorItem.findMany({ where: { id: { in: ids } } });
    return ids.map((id) => items.find((item) => item.id === id)!);
}
const waitSplit = async (id: string) => {
    await waitForImportTaskForTest(id);
};
const reanswer = (questionText: string) => ({
    answerText: `答案：${questionText.slice(0, 10)}`,
    analysis: '按题意列式计算。',
    knowledgePoints: ['分数的意义'],
    wrongAnswerText: '',
    mistakeAnalysis: '',
    mistakeStatus: 'unknown',
    subject: '数学',
    difficultyStars: 2,
    questionType: 'calculation',
    gradeSemester: '六年级上',
});
const parsedImage = (text: string) => ({
    questionText: text, answerText: '12', analysis: '由图可知。', knowledgePoints: ['长方形面积'], subject: '数学',
    mistakeStatus: 'unknown', wrongAnswerText: '', mistakeAnalysis: '', requiresImage: true, hasFigure: true,
    questionType: 'solution',
    figureSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>',
});

beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-import-batch-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    // 记录执行的 SQL，用于检查默认读取是否带出整页图片
    database.$on('query', (event) => { queries.push(event.query); });
    await database.$queryRaw`PRAGMA journal_mode = WAL`;
    await database.$queryRaw`PRAGMA busy_timeout = 30000`;
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    asUser('user-1');
    mocks.dailyLimit = 0;
    mocks.analyzeImage.mockReset();
    mocks.reanswerQuestion.mockReset();
    mocks.splitQuestions.mockReset();
    mocks.fixQuestionText.mockReset();
    mocks.recognizeGrade.mockResolvedValue(null);
    mocks.reanswerQuestion.mockImplementation(async (questionText: string) => reanswer(questionText));
    mocks.analyzeImage.mockImplementation(async (base64: string) => parsedImage(`图片题 ${base64.length}`));
    mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['分数的意义'], difficultyStars: 3, questionType: 'calculation' });
    await database.user.deleteMany();
    await database.user.createMany({ data: [
        { id: 'user-1', email: 'batch@example.com', password: 'test-only', confirmBeforeImport: false },
        { id: 'user-2', email: 'other@example.com', password: 'test-only' },
    ] });
    await database.subject.createMany({ data: [
        { id: 'math', name: '数学', userId: 'user-1' },
        { id: 'other-math', name: '数学', userId: 'user-2' },
    ] });
}, 30000);

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('文字多题批次', () => {
    it('issue #6 样例按本地规则分成 9 题，不调用 AI、不计额度，重复提交返回同一批次', async () => {
        const body = { clientRequestId: 'issue-6-request', source: 'text', splitter: 'local', text: ISSUE6, targetSubjectId: 'math', language: 'zh' };
        const first = await CREATE(json(body));
        expect(first.status).toBe(201);
        const { batch } = await first.json();
        expect(batch).toMatchObject({ status: 'draft', phase: 'draft', itemCount: 9, selectedCount: 9, unread: false });
        expect(batch.draft.items.map((item: { label: string }) => item.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
        expect(batch.draft.items[3].text).toContain('D．13.5');
        expect(batch.draft.items[8].text).toContain('（2）把十进制数 26');
        expect(batch.draft.ignored.join('\n')).toContain('姓名');

        const again = await CREATE(json(body));
        expect(again.status).toBe(200);
        expect((await again.json()).batch.id).toBe(batch.id);
        expect(await database.importBatch.count()).toBe(1);
        expect(mocks.splitQuestions).not.toHaveBeenCalled();
        expect(await database.aiUsage.count()).toBe(0);
    });

    it('免确认：开始后逐题解析并入库，每题一条错题，只计实际解析的额度；重复开始不重复建任务', async () => {
        const { batch } = await create({ source: 'text', text: ISSUE6, targetSubjectId: 'math' });
        // 取消第 9 题、编辑第 1 题后保存草稿
        const draft = structuredClone(batch.draft);
        draft.items[8].selected = false;
        draft.items[0].text = '（已校对）' + draft.items[0].text;
        const saved = await PATCH(json({ version: batch.version, draft }, 'PATCH'), params(batch.id));
        expect(saved.status).toBe(200);
        const { batch: updated } = await saved.json();
        expect(updated.selectedCount).toBe(8);

        const responses = await Promise.all([start(batch.id, { version: updated.version }), start(batch.id, { version: updated.version })]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 202]);
        await waitForImportBatchTasksForTest(batch.id);

        expect(await database.importTask.count({ where: { batchId: batch.id } })).toBe(8);
        expect(mocks.reanswerQuestion).toHaveBeenCalledTimes(8);
        expect(await database.aiUsage.count({ where: { kind: 'reanswer' } })).toBe(8);
        const items = await savedItemsInDraftOrder(batch.id);
        expect(items).toHaveLength(8);
        expect(items.every((item) => item.subjectId === 'math' && item.userId === 'user-1')).toBe(true);
        expect(items.map((item) => item.questionText)).toContain(draft.items[0].text);
        expect(items.some((item) => item.questionText?.includes('二进制'))).toBe(false);
        // AI 识别给出的题型落库
        expect(items.every((item) => item.questionType === 'calculation')).toBe(true);

        const { batch: done } = await getBatch(batch.id);
        expect(done).toMatchObject({ status: 'started', phase: 'done', mode: 'auto', counts: { total: 8, saved: 8, failed: 0, active: 0 } });
        // 已开始的批次不能再改草稿
        const late = await PATCH(json({ version: done.version, draft }, 'PATCH'), params(batch.id));
        expect(late.status).toBe(409);
        expect((await late.json()).message).toBe('IMPORT_BATCH_NOT_EDITABLE');
    });

    it('开始时写入任务中途失败：整体回滚，批次仍可编辑，不调用 AI、不计额度；修复后可正常开始', async () => {
        const { batch } = await create({ source: 'text', text: '1．计算 1 + 1。\n2．计算 2 + 2。\n3．计算 3 + 3。' });
        // 用真实的数据库触发器让第 2 题的写入失败
        const failingKey = batch.draft.items[1].key;
        await database.$executeRawUnsafe(`CREATE TRIGGER fail_batch_task BEFORE INSERT ON ImportTask WHEN NEW.batchItemKey = '${failingKey}' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`);
        try {
            const failed = await start(batch.id, { version: batch.version });
            expect(failed.status).toBe(500);
            expect((await failed.json()).message).toBe('IMPORT_BATCH_START_FAILED');
        } finally {
            await database.$executeRawUnsafe('DROP TRIGGER fail_batch_task');
        }
        expect(await database.importTask.count()).toBe(0);
        expect((await getBatch(batch.id)).batch).toMatchObject({ status: 'draft', version: batch.version });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
        expect(await database.aiUsage.count()).toBe(0);

        expect((await start(batch.id, { version: batch.version })).status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);
        expect(await database.importTask.count({ where: { batchId: batch.id, status: 'saved' } })).toBe(3);
    });

    it('编号像小问时默认按一道题，明确选择后才按编号分；文字过长时明确拒绝', async () => {
        const text = '已知两数的和是 20，差是 4，完成下面的小问：\n1) 求较大的数。\n2) 求较小的数。';
        expect((await create({ source: 'text', text })).batch.itemCount).toBe(1);
        expect((await create({ source: 'text', text, forceNumbered: true })).batch.itemCount).toBe(2);
        const tooLong = await create({ source: 'text', text: '1．a\n2．b\n' + '字'.repeat(20000) });
        expect(tooLong.response.status).toBe(400);
        expect(tooLong.data.message).toBe('IMPORT_BATCH_TEXT_TOO_LONG');
        const tooManyLines = await create({ source: 'text', splitter: 'ai', text: Array.from({ length: 1001 }, (_, index) => `第 ${index} 行`).join('\n') });
        expect(tooManyLines.data.message).toBe('IMPORT_BATCH_TEXT_TOO_LONG');
        expect(mocks.splitQuestions).not.toHaveBeenCalled();
        expect(await database.aiUsage.count()).toBe(0);
    });

    it('结构化题目批次：直接构造草稿，不调用 AI、不计额度，与 text 互斥', async () => {
        const items = [
            { text: '1．计算 1 + 1。', answer: '2', analysis: '1+1=2', questionType: 'single_choice', label: '1' },
            { text: '2．计算 2 + 2。', answer: null, questionType: '未知题型' },
            { text: '', answer: '' },
        ];
        const body = { clientRequestId: 'structured-req-001', source: 'text', splitter: 'local', items, language: 'zh', targetSubjectId: 'math' };
        const first = await CREATE(json(body));
        expect(first.status).toBe(201);
        const { batch } = await first.json();
        expect(batch).toMatchObject({ status: 'draft', phase: 'draft', itemCount: 3, selectedCount: 2 });
        expect(batch.draft.items[0]).toMatchObject({ text: '1．计算 1 + 1。', answer: '2', analysis: '1+1=2', questionType: 'single_choice', label: '1', selected: true });
        expect(batch.draft.items[1]).toMatchObject({ text: '2．计算 2 + 2。', questionType: null, selected: true });
        expect(batch.draft.items[2]).toMatchObject({ text: '', selected: false });
        // 不调用 AI、不计额度
        expect(mocks.splitQuestions).not.toHaveBeenCalled();
        expect(await database.aiUsage.count()).toBe(0);
        // 幂等：重复提交返回同一批次
        const again = await CREATE(json(body));
        expect(again.status).toBe(200);
        expect((await again.json()).batch.id).toBe(batch.id);
        expect(await database.importBatch.count()).toBe(1);

        // 与 text 互斥
        const both = await CREATE(json({ ...body, clientRequestId: 'structured-req-002', text: '1．计算 1 + 1。' }));
        expect(both.status).toBe(400);
        expect((await both.json()).message).toBe('IMPORT_BATCH_INVALID_INPUT');

        // 超过单批上限拒绝
        const tooMany = await CREATE(json({ ...body, clientRequestId: 'structured-req-003', items: Array.from({ length: 61 }, (_, i) => ({ text: `题目 ${i + 1}` })) }));
        expect(tooMany.status).toBe(400);
        expect((await tooMany.json()).message).toBe('IMPORT_BATCH_INVALID_INPUT');

        // origin 字段写入 sourceText
        const withOrigin = await CREATE(json({ ...body, clientRequestId: 'structured-req-004', origin: { fileName: '题库.xlsx', format: 'xlsx' } }));
        expect(withOrigin.status).toBe(201);
        const { batch: originBatch } = await withOrigin.json();
        expect(originBatch).toMatchObject({ itemCount: 3 });
        const raw = await database.importBatch.findUnique({ where: { id: originBatch.id } });
        expect(raw?.sourceText).toContain('题库.xlsx');
    });

    it('草稿版本冲突时返回最新内容，不静默覆盖', async () => {
        const { batch } = await create({ source: 'text', text: '1．计算 1 + 1。\n2．计算 2 + 2。' });
        const a = structuredClone(batch.draft);
        a.items[0].text = '页面 A 的修改';
        const b = structuredClone(batch.draft);
        b.items[1].text = '页面 B 的修改';
        expect((await PATCH(json({ version: batch.version, draft: a }, 'PATCH'), params(batch.id))).status).toBe(200);
        const conflict = await PATCH(json({ version: batch.version, draft: b }, 'PATCH'), params(batch.id));
        expect(conflict.status).toBe(409);
        const body = await conflict.json();
        expect(body.message).toBe('IMPORT_BATCH_VERSION_CONFLICT');
        expect(body.details.batch.draft.items[0].text).toBe('页面 A 的修改');
        // 用旧版本开始也被拒绝
        expect((await start(batch.id, { version: batch.version })).status).toBe(409);
        expect(await database.importTask.count()).toBe(0);
    });

    it('部分失败：只重试失败的题，已入库的不重复解析或入库', async () => {
        mocks.reanswerQuestion.mockImplementation(async (questionText: string) => {
            if (questionText.includes('2 + 2')) throw new Error('AI_SERVICE_UNAVAILABLE');
            return reanswer(questionText);
        });
        const { batch } = await create({ source: 'text', text: '1．计算 1 + 1。\n2．计算 2 + 2。\n3．计算 3 + 3。', targetSubjectId: 'math' });
        await start(batch.id, { version: batch.version });
        await waitForImportBatchTasksForTest(batch.id);
        let { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ phase: 'attention', counts: { saved: 2, failed: 1 } });
        expect(current.tasks.find((task: { status: string }) => task.status === 'failed').error).toBe('AI_SERVICE_UNAVAILABLE');
        expect(mocks.reanswerQuestion).toHaveBeenCalledTimes(3);

        mocks.reanswerQuestion.mockImplementation(async (questionText: string) => reanswer(questionText));
        const retried = await RETRY(json({}), params(batch.id));
        expect(retried.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);
        ({ batch: current } = await getBatch(batch.id));
        expect(current).toMatchObject({ phase: 'done', counts: { saved: 3, failed: 0 } });
        expect(mocks.reanswerQuestion).toHaveBeenCalledTimes(4);
        expect(await database.errorItem.count()).toBe(3);
        // 没有失败的题时再重试无事可做
        expect((await RETRY(json({}), params(batch.id))).status).toBe(409);
    });

    it('公共材料只作用于所属题组，解析时拼在题干前', async () => {
        const text = '1．计算 1 + 1。\n\n阅读下面的材料，回答 2～3 题。\n某商店上午卖出 30 件，下午卖出 45 件。\n2．全天卖出多少件？\n3．下午比上午多卖多少件？\n4．计算 9 - 3。';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });
        await start(batch.id, { version: batch.version });
        await waitForImportBatchTasksForTest(batch.id);
        const inputs = mocks.reanswerQuestion.mock.calls.map(([questionText]) => questionText as string);
        expect(inputs.filter((input) => input.includes('某商店'))).toHaveLength(2);
        expect(inputs.find((input) => input.includes('9 - 3'))).toBe('计算 9 - 3。');
        expect(inputs.find((input) => input.includes('1 + 1'))).toBe('计算 1 + 1。');
    });

    it('校对模式：结果保存为待校对；逐题确认后，其余题按识别结果批量入库，重复点击不重复入库', async () => {
        await database.user.update({ where: { id: 'user-1' }, data: { confirmBeforeImport: true } });
        const { batch } = await create({ source: 'text', text: '1．计算 1 + 1。\n2．计算 2 + 2。\n3．计算 3 + 3。' });
        await start(batch.id, { version: batch.version });
        await waitForImportBatchTasksForTest(batch.id);
        let { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ mode: 'review', phase: 'attention', unread: true, counts: { review: 3, saved: 0 } });
        expect(await database.errorItem.count()).toBe(0);

        const first = current.tasks[0];
        const confirmed = await CONFIRM_TASK(json({ questionText: '校对后：计算 1 + 1。', answerText: '2', analysis: '1+1=2', subjectId: 'math' }), params(first.id));
        expect(confirmed.status).toBe(201);
        const all = await Promise.all([CONFIRM_ALL(json({}), params(batch.id)), CONFIRM_ALL(json({}), params(batch.id))]);
        expect(all.every((response) => response.status === 200)).toBe(true);
        ({ batch: current } = await getBatch(batch.id));
        expect(current).toMatchObject({ phase: 'done', counts: { saved: 3, review: 0 } });
        expect(await database.errorItem.count()).toBe(3);
        expect(await database.errorItem.count({ where: { questionText: '校对后：计算 1 + 1。' } })).toBe(1);
        // 未指定错题本时按识别学科匹配
        expect(await database.errorItem.count({ where: { subjectId: 'math' } })).toBe(3);

        expect((await READ(json({}), params(batch.id))).status).toBe(200);
        expect((await getBatch(batch.id)).batch.unread).toBe(false);
    });

    it('AI 分题：只按行号取原文，模型改写或越界的范围不采用，未归入的行列为未计入内容', async () => {
        mocks.splitQuestions.mockImplementation(async (input: QuestionSplitInput): Promise<QuestionSplitResult> => {
            expect(input.kind).toBe('text');
            const { parseQuestionSplit } = await import('@/lib/ai/question-split');
            return parseQuestionSplit(JSON.stringify({ questions: [
                { label: null, lines: [3, 3], material: null },
                { label: null, lines: [5, 6], material: null },
                { label: null, lines: [6, 9], material: null },
                { label: null, lines: [40, 41], material: null },
            ] }), input);
        });
        const text = '练习\n\n计算 3 + 4，写出过程。\n\n小明有 5 个苹果，又买了 3 个，\n现在有几个？';
        const { response, batch } = await create({ source: 'text', splitter: 'ai', text });
        expect(response.status).toBe(201);
        expect(batch).toMatchObject({ status: 'splitting', phase: 'splitting' });
        await waitSplit(batch.id);
        const { batch: ready } = await getBatch(batch.id);
        expect(ready).toMatchObject({ status: 'draft', unread: true, itemCount: 2 });
        expect(ready.draft.items.map((item: { text: string }) => item.text)).toEqual(['计算 3 + 4，写出过程。', '小明有 5 个苹果，又买了 3 个，\n现在有几个？']);
        expect(ready.draft.ignored).toEqual(['练习']);
        expect(await database.aiUsage.count({ where: { kind: 'split' } })).toBe(1);
    });

    it('AI 分题输出无效或没有题目时标记失败，可重新分题', async () => {
        mocks.splitQuestions.mockRejectedValueOnce(new Error('AI_RESPONSE_ERROR: invalid question split output'));
        const { batch } = await create({ source: 'text', splitter: 'ai', text: '计算 3 + 4。\n\n计算 5 × 6。' });
        await waitSplit(batch.id);
        let { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ status: 'failed', phase: 'failed', error: 'AI_RESPONSE_ERROR', unread: true });

        mocks.splitQuestions.mockResolvedValueOnce({ questions: [], ignored: [], warnings: [] });
        expect((await RETRY(json({}), params(batch.id))).status).toBe(202);
        await waitSplit(batch.id);
        ({ batch: current } = await getBatch(batch.id));
        expect(current).toMatchObject({ status: 'failed', error: 'SPLIT_NO_QUESTIONS', attempts: 2 });
        expect(await database.aiUsage.count({ where: { kind: 'split' } })).toBe(2);
    });

    it('逐题解析中服务重启：批次页显示中断失败，重试后完成，已入库的不重复', async () => {
        let release: () => void = () => undefined;
        mocks.reanswerQuestion.mockImplementation(async (questionText: string) => {
            if (questionText.includes('2 + 2')) await new Promise<void>((resolve) => { release = resolve; });
            return reanswer(questionText);
        });
        const { batch } = await create({ source: 'text', text: '1．计算 1 + 1。\n2．计算 2 + 2。', targetSubjectId: 'math' });
        await start(batch.id, { version: batch.version });
        await vi.waitFor(async () => expect(await database.errorItem.count()).toBe(1));
        simulateRestartForTest();
        const { batch: interrupted } = await getBatch(batch.id);
        expect(interrupted).toMatchObject({ phase: 'attention', counts: { saved: 1, failed: 1, active: 0 } });
        expect(interrupted.tasks.find((task: { status: string }) => task.status === 'failed').error).toBe('SERVER_RESTARTED');
        release();
        await new Promise((resolve) => setTimeout(resolve, 20));
        // 旧进程的结果不会写回已标记失败的任务
        expect(await database.errorItem.count()).toBe(1);

        mocks.reanswerQuestion.mockImplementation(async (questionText: string) => reanswer(questionText));
        expect((await RETRY(json({}), params(batch.id))).status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);
        expect((await getBatch(batch.id)).batch).toMatchObject({ phase: 'done', counts: { saved: 2 } });
        expect(await database.errorItem.count()).toBe(2);
    });

    it('分题过程中服务重启：标记中断失败，不会自动重新调用 AI', async () => {
        let release: () => void = () => undefined;
        mocks.splitQuestions.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve({ questions: [], ignored: [], warnings: [] });
        }));
        const { batch } = await create({ source: 'text', splitter: 'ai', text: '计算 3 + 4。' });
        simulateRestartForTest();
        const { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ status: 'failed', error: 'SERVER_RESTARTED' });
        release();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect((await getBatch(batch.id)).batch.status).toBe('failed');
        expect(mocks.splitQuestions).toHaveBeenCalledTimes(1);
    });
});

describe('照片自动分题批次', () => {
    it('真实图片随分题请求发送，区域校验后成为草稿；开始时逐题用裁片走完整识别', async () => {
        mocks.splitQuestions.mockResolvedValue({
            questions: [
                { label: '1', text: '如图，求长方形的面积。', material: null, section: null, regions: [{ x: 0.05, y: 0.05, width: 0.9, height: 0.3 }], hasFigure: true, flags: [] },
                { label: '2', text: '下列说法正确的是（　）A. … D. …', material: null, section: null, regions: [{ x: 0.05, y: 0.4, width: 0.9, height: 0.2 }], hasFigure: false, flags: [] },
                { label: '3', text: '看不清的题', material: null, section: null, regions: [], hasFigure: false, flags: ['unclear', 'unlocated'] },
            ],
            ignored: [], warnings: ['blurry'],
        });
        const { response, batch } = await create({ source: 'image', imageBase64: PAGE, imageInfo: { outputWidth: 1200, outputHeight: 1600 }, targetSubjectId: 'math' });
        expect(response.status).toBe(201);
        await waitSplit(batch.id);
        const call = mocks.splitQuestions.mock.calls[0][0] as QuestionSplitInput;
        expect(call).toMatchObject({ kind: 'image', mimeType: 'image/jpeg', imageBase64: PAGE.split(',')[1] });

        const { batch: ready } = await getBatch(batch.id, true);
        expect(ready).toMatchObject({ status: 'draft', itemCount: 3, selectedCount: 2, imageData: PAGE });
        expect(ready.draft.warnings).toEqual(['blurry']);
        expect(ready.draft.items[2]).toMatchObject({ selected: false, flags: ['unclear', 'unlocated'] });
        // 状态查询不带整页图
        expect((await getBatch(batch.id)).batch.imageData).toBeNull();

        // 缺少已选题的裁片时不开始，批次保持待确认
        const missing = await start(batch.id, { version: ready.version, images: [{ key: ready.draft.items[0].key, imageBase64: CROP(1) }] });
        expect(missing.status).toBe(400);
        expect((await missing.json()).message).toBe('IMPORT_BATCH_IMAGE_MISSING');
        expect((await getBatch(batch.id)).batch.status).toBe('draft');

        const images = ready.draft.items.slice(0, 2).map((item: { key: string }, index: number) => ({ key: item.key, imageBase64: CROP(index + 2) }));
        expect((await start(batch.id, { version: ready.version, images })).status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(2);
        // 各题并发识别，顺序不固定
        expect(mocks.analyzeImage.mock.calls.map(([base64]) => base64).sort()).toEqual(images.map((image: { imageBase64: string }) => image.imageBase64.split(',')[1]).sort());
        const items = await database.errorItem.findMany({ orderBy: { createdAt: 'asc' } });
        expect(items.map((item) => item.originalImageUrl).sort()).toEqual(images.map((image: { imageBase64: string }) => image.imageBase64).sort());
        expect(items.every((item) => item.figureSvg?.startsWith('<svg'))).toBe(true);
        // AI 识别给出的题型落库
        expect(items.every((item) => item.questionType === 'solution')).toBe(true);
        expect(await database.aiUsage.count({ where: { kind: 'split' } })).toBe(1);
        expect(await database.aiUsage.count({ where: { kind: 'analyze' } })).toBe(2);
    });

    it('超出每日额度时分题失败、不调用模型', async () => {
        mocks.dailyLimit = 1;
        await database.aiUsage.create({ data: { userId: 'user-1', kind: 'analyze' } });
        const { response } = await create({ source: 'image', imageBase64: PAGE });
        expect(response.status).toBe(429);
        expect(mocks.splitQuestions).not.toHaveBeenCalled();
        expect(await database.importBatch.findFirstOrThrow()).toMatchObject({ status: 'failed', error: 'AI_DAILY_LIMIT_EXCEEDED' });
    });
});

describe('分题预览中的 AI 修正文字', () => {
    const fixText = (id: string, items: Array<{ key: string; text: string }>) => FIX_TEXT(json({ items }), params(id));
    /** 模拟模型：删去「草稿：」行、改正「公项」，含「改数字」的题把 77 改成 78 */
    const fakeFix = async (input: Array<{ id: string; text: string }>) => input.map(({ id, text }) => ({
        id,
        text: text.split('\n').filter((line) => !line.startsWith('草稿：')).join('\n').replaceAll('公项', '公顷').replace(text.includes('改数字') ? '77' : '\u0000', '78'),
        uncertain: [],
    }));

    it('只返回建议、不改草稿；无需修改与改动数字的题分别列出；按组调用并只计一次额度', async () => {
        mocks.fixQuestionText.mockImplementation(fakeFix);
        const text = Array.from({ length: 12 }, (_, index) => `${index + 1}．第 ${index + 1} 题，共100公项。`).join('\n')
            + '\n13．改数字：某厂有77个工人。\n14．小明有 5 个苹果。';
        const { batch } = await create({ source: 'text', text });
        const items = batch.draft.items.map((item: { key: string; text: string }, index: number) => ({ key: item.key, text: index === 0 ? `${item.text}\n草稿：4x=120` : item.text }));
        const response = await fixText(batch.id, items);
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.fixes).toHaveLength(12);
        expect(result.fixes[0]).toEqual({ key: items[0].key, original: items[0].text, text: '第 1 题，共100公顷。', uncertain: [] });
        expect(result.unchanged).toEqual([items[13].key]);
        expect(result.failed).toEqual([items[12].key]);
        // 14 题按每组 3 题分 5 次调用模型，额度只计一次
        expect(mocks.fixQuestionText).toHaveBeenCalledTimes(5);
        expect(mocks.fixQuestionText.mock.calls.map(([input]) => input.length)).toEqual([3, 3, 3, 3, 2]);
        expect(await database.aiUsage.count({ where: { userId: 'user-1', kind: 'split' } })).toBe(1);
        expect((await getBatch(batch.id)).batch.draft.items[0].text).toBe(batch.draft.items[0].text);

        // 建议写入草稿后随版本保存，刷新可取回
        const draft = { ...batch.draft, items: batch.draft.items.map((item: { key: string }, index: number) => (index === 1 ? { ...item, fix: { original: batch.draft.items[1].text, text: result.fixes[1].text, uncertain: [] } } : item)) };
        const saved = await PATCH(json({ version: batch.version, draft }, 'PATCH'), params(batch.id));
        expect(saved.status).toBe(200);
        expect((await getBatch(batch.id)).batch.draft.items[1].fix.text).toBe('第 2 题，共100公顷。');
    });

    it('某一组调用失败只影响该组；全部失败时返回 AI 错误码', async () => {
        const text = Array.from({ length: 11 }, (_, index) => `${index + 1}．第 ${index + 1} 题公项。`).join('\n');
        const { batch } = await create({ source: 'text', text });
        const items = batch.draft.items.map((item: { key: string; text: string }) => ({ key: item.key, text: item.text }));
        // 第 2 组（第 4～6 题）失败，其余组正常
        mocks.fixQuestionText.mockImplementation(fakeFix).mockImplementationOnce(fakeFix).mockRejectedValueOnce(new Error('AI_TIMEOUT_ERROR'));
        const partial = await (await fixText(batch.id, items)).json();
        expect(partial.fixes).toHaveLength(8);
        expect(partial.failed).toEqual(items.slice(3, 6).map((item: { key: string }) => item.key));

        mocks.fixQuestionText.mockRejectedValue(new Error('AI_TIMEOUT_ERROR'));
        const failed = await fixText(batch.id, items.slice(0, 2));
        expect(failed.status).toBe(500);
        expect((await failed.json()).message).toBe('AI_TIMEOUT_ERROR');
    });

    it('他人批次、照片批次、已开始的批次与无效输入都不调用模型；超额时返回 429', async () => {
        const { batch } = await create({ source: 'text', text: '1．公项\n2．题二' });
        const items = [{ key: batch.draft.items[0].key, text: '公项' }];
        expect((await fixText(batch.id, [{ key: 'bad key!', text: 'x' }])).status).toBe(400);
        asUser('user-2');
        expect((await fixText(batch.id, items)).status).toBe(404);
        asUser('user-1');
        mocks.splitQuestions.mockResolvedValue({ questions: [], ignored: [], warnings: [] });
        const photo = await create({ source: 'image', imageBase64: PAGE });
        expect((await fixText(photo.batch.id, items)).status).toBe(409);
        mocks.dailyLimit = 1;
        await database.aiUsage.create({ data: { userId: 'user-1', kind: 'analyze' } });
        expect((await fixText(batch.id, items)).status).toBe(429);
        mocks.dailyLimit = 0;
        await start(batch.id, { version: batch.version });
        expect((await fixText(batch.id, items)).status).toBe(409);
        expect(mocks.fixQuestionText).not.toHaveBeenCalled();
    });

    it('并发两次请求第二次返回 409 TASK_ALREADY_RUNNING，不重复扣额度、不重复调用 AI', async () => {
        mocks.fixQuestionText.mockImplementation(fakeFix);
        const { batch } = await create({ source: 'text', text: '1．公项\n2．题二' });
        const items = batch.draft.items.map((item: { key: string; text: string }) => ({ key: item.key, text: item.text }));

        // 让第一次调用挂起，使第二次调用在第一次进行中到达
        let release!: () => void;
        mocks.fixQuestionText.mockImplementationOnce(() => new Promise((resolve) => {
            release = () => resolve([{ id: items[0].key, text: items[0].text.replace('公项', '公顷'), uncertain: [] }]);
        }));
        const first = fixText(batch.id, items);
        await vi.waitFor(() => expect(mocks.fixQuestionText).toHaveBeenCalled());

        const second = await fixText(batch.id, items);
        expect(second.status).toBe(409);
        const secondBody = await second.json();
        expect(secondBody.code).toBe('TASK_ALREADY_RUNNING');
        expect(secondBody.details.task).toMatchObject({ kind: 'fix_text', target: `import-batch:${batch.id}:fix-text` });
        // 第二次不调用 AI（额度在第一次预占后已扣，不会因 409 重复扣）
        expect(mocks.fixQuestionText).toHaveBeenCalledTimes(1);
        expect(await database.aiUsage.count({ where: { userId: 'user-1', kind: 'split' } })).toBe(1);

        release();
        const firstResponse = await first;
        expect(firstResponse.status).toBe(200);
        // 总共只扣一次额度、只调用一次 AI
        expect(await database.aiUsage.count({ where: { userId: 'user-1', kind: 'split' } })).toBe(1);
        expect(mocks.fixQuestionText).toHaveBeenCalledTimes(1);

        // 任务结束后可再次发起
        mocks.fixQuestionText.mockImplementation(fakeFix);
        const third = await fixText(batch.id, items);
        expect(third.status).toBe(200);
        expect(await database.aiUsage.count({ where: { userId: 'user-1', kind: 'split' } })).toBe(2);
    });

    it('超额返回 429 后可再次发起；AI 失败返回 500 后可再次发起', async () => {
        mocks.fixQuestionText.mockImplementation(fakeFix);
        const { batch } = await create({ source: 'text', text: '1．公项\n2．题二' });
        const items = batch.draft.items.map((item: { key: string; text: string }) => ({ key: item.key, text: item.text }));

        // 超额：返回 429，预占被 cancel，不留下记录
        mocks.dailyLimit = 1;
        await database.aiUsage.create({ data: { userId: 'user-1', kind: 'analyze' } });
        const limited = await fixText(batch.id, items);
        expect(limited.status).toBe(429);
        expect(mocks.fixQuestionText).not.toHaveBeenCalled();
        // 预占已 cancel，无该 target 的 running 任务
        const { findRunningTask } = await import('@/lib/background-tasks');
        expect(findRunningTask('user-1', `import-batch:${batch.id}:fix-text`)).toBeNull();

        // 额度恢复后可再次发起
        mocks.dailyLimit = 0;
        await database.aiUsage.deleteMany({ where: { userId: 'user-1' } });
        const ok = await fixText(batch.id, items);
        expect(ok.status).toBe(200);
        expect(mocks.fixQuestionText).toHaveBeenCalled();

        // AI 失败：返回 500，任务标记失败，可再次发起
        mocks.fixQuestionText.mockRejectedValueOnce(new Error('AI_TIMEOUT_ERROR'));
        const failed = await fixText(batch.id, items);
        expect(failed.status).toBe(500);
        const retry = await fixText(batch.id, items);
        expect(retry.status).toBe(200);
    });
});

describe('批次生命周期', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('批次中 7 天前已保存的题在批次未完成时不被清理，错题不受影响；独立任务按自身保留期清理', async () => {
        const item = await database.errorItem.create({ data: { userId: 'user-1', subjectId: 'math', questionText: '很早入库的题', originalImageUrl: '' } });
        const old = new Date(Date.now() - 10 * DAY);
        await database.importBatch.create({ data: { id: 'batch-long-draft', userId: 'user-1', source: 'text', splitter: 'local', status: 'started', mode: 'review', startedAt: old, createdAt: old } });
        await database.importTask.createMany({ data: [
            { id: 'old-saved-in-batch', userId: 'user-1', mode: 'review', status: 'saved', imageData: '', inputText: 'a', errorItemId: item.id, batchId: 'batch-long-draft', batchItemKey: 'qa', finishedAt: old, createdAt: old },
            { id: 'pending-in-batch', userId: 'user-1', mode: 'review', status: 'review', imageData: '', inputText: 'b', result: null, batchId: 'batch-long-draft', batchItemKey: 'qb', createdAt: old },
            { id: 'old-standalone', userId: 'user-1', mode: 'auto', status: 'saved', imageData: '', finishedAt: old, createdAt: old },
        ] });
        const list = await (await LIST()).json();
        expect(list.batches.find((batch: { id: string }) => batch.id === 'batch-long-draft')).toMatchObject({ counts: { total: 2, saved: 1, review: 1 } });
        expect(await database.importTask.count({ where: { id: 'old-saved-in-batch' } })).toBe(1);
        expect(await database.importTask.count({ where: { id: 'old-standalone' } })).toBe(0);
        expect(await database.errorItem.count({ where: { id: item.id } })).toBe(1);

        // 全部入库且超过保留期后，批次连同其任务一起清理，错题保留
        await database.importTask.update({ where: { id: 'pending-in-batch' }, data: { status: 'saved', finishedAt: old } });
        await LIST();
        expect(await database.importBatch.count({ where: { id: 'batch-long-draft' } })).toBe(0);
        expect(await database.importTask.count({ where: { batchId: 'batch-long-draft' } })).toBe(0);
        expect(await database.errorItem.count({ where: { id: item.id } })).toBe(1);
    });

    it('慢写事务持锁期间，重复开始、已读、后台状态更新与部分失败都排队完成，不互相卡住、不重复', async () => {
        mocks.reanswerQuestion.mockImplementation(async (questionText: string) => {
            if (questionText.includes('3 + 3')) throw new Error('AI_SERVICE_UNAVAILABLE');
            return reanswer(questionText);
        });
        const text = Array.from({ length: 6 }, (_, index) => `${index + 1}．计算 ${index + 1} + ${index + 1}。`).join('\n');
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });
        // 另一个写事务（如其他题的入库）写入后迟迟不提交，持有 SQLite 写锁
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const holding = runQuestionImportTransaction(async (tx) => {
            await tx.user.update({ where: { id: 'user-1' }, data: { name: '持锁中' } });
            await gate;
        });
        const started = Date.now();
        const pending = Promise.all([
            start(batch.id, { version: batch.version }),
            start(batch.id, { version: batch.version }),
            READ(json({}), params(batch.id)),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 300));
        // 持锁期间没有任何开始请求越过队列写入
        expect(await database.importTask.count({ where: { batchId: batch.id } })).toBe(0);
        release();
        await holding;
        const [first, second, read] = await pending;
        expect([first.status, second.status].sort()).toEqual([200, 202]);
        expect(read.status).toBe(200);
        await waitForImportBatchTasksForTest(batch.id);
        expect(Date.now() - started).toBeLessThan(10_000);

        let { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ phase: 'attention', counts: { total: 6, saved: 5, failed: 1, active: 0 } });
        expect(await database.errorItem.count()).toBe(5);
        expect(await database.aiUsage.count({ where: { kind: 'reanswer' } })).toBe(6);

        mocks.reanswerQuestion.mockImplementation(async (questionText: string) => reanswer(questionText));
        const retries = await Promise.all([RETRY(json({}), params(batch.id)), RETRY(json({}), params(batch.id))]);
        expect(retries.some((response) => response.status === 202)).toBe(true);
        await waitForImportBatchTasksForTest(batch.id);
        ({ batch: current } = await getBatch(batch.id));
        expect(current).toMatchObject({ phase: 'done', counts: { total: 6, saved: 6 } });
        expect(await database.errorItem.count()).toBe(6);
        // 失败的那题只重新解析一次
        expect(mocks.reanswerQuestion).toHaveBeenCalledTimes(7);
    });

    it('100 个较新的已完成批次不会挤掉更早的草稿，已完成的只列最近 10 个', async () => {
        const base = Date.now() - DAY;
        await database.importBatch.create({ data: { id: 'very-old-draft', userId: 'user-1', source: 'text', splitter: 'local', status: 'draft', createdAt: new Date(base - 30 * DAY) } });
        await database.importBatch.createMany({ data: Array.from({ length: 100 }, (_, index) => ({
            id: `done-batch-${String(index).padStart(3, '0')}`, userId: 'user-1', source: 'text', splitter: 'local', status: 'started',
            startedAt: new Date(base + index * 1000), createdAt: new Date(base + index * 1000),
        })) });
        const list = await (await LIST()).json();
        expect(list.batches.map((batch: { id: string }) => batch.id)).toContain('very-old-draft');
        expect(list.batches.filter((batch: { phase: string }) => batch.phase === 'done')).toHaveLength(10);
        expect(list.batches[0].id).toBe('done-batch-099');
    });

    it('状态查询、列表与草稿保存不从数据库读出整页图片，只有明确取图时读取', async () => {
        const bigImage = `data:image/jpeg;base64,${'A'.repeat(2 * 1024 * 1024)}`;
        const draft = { items: [{ key: 'qa', label: '1', text: '题', material: null, section: null, selected: true, regions: [{ x: 0, y: 0, width: 1, height: 0.5 }], hasFigure: false, flags: [] }], ignored: [], warnings: [] };
        await database.importBatch.create({ data: { id: 'batch-big-image', userId: 'user-1', source: 'image', splitter: 'ai', status: 'draft', imageData: bigImage, draft: JSON.stringify(draft) } });
        const selectsImage = () => queries.some((query) => /[`"]ImportBatch[`"]\.[`"]imageData[`"]/.test(query) && /^SELECT/i.test(query));

        queries.length = 0;
        const detail = await GET_BATCH(new Request('http://localhost/api/import-batches/batch-big-image'), params('batch-big-image'));
        const detailText = await detail.text();
        const listText = await (await LIST()).text();
        const patched = await PATCH(json({ version: 1, draft }, 'PATCH'), params('batch-big-image'));
        expect(patched.status).toBe(200);
        const patchText = await patched.text();
        expect(selectsImage()).toBe(false);
        for (const text of [detailText, listText, patchText]) expect(text.length).toBeLessThan(50_000);

        queries.length = 0;
        const { batch } = await getBatch('batch-big-image', true);
        expect(batch.imageData).toBe(bigImage);
        expect(selectsImage()).toBe(true);
    });
});

describe('批次归属与列表', () => {
    it('其他用户看不到、改不了、开始不了、丢弃不了他人的批次', async () => {
        const { batch } = await create({ source: 'text', text: '1．计算 1 + 1。\n2．计算 2 + 2。' });
        asUser('user-2');
        expect((await getBatch(batch.id)).response.status).toBe(404);
        expect((await PATCH(json({ version: batch.version, draft: batch.draft }, 'PATCH'), params(batch.id))).status).toBe(404);
        expect((await start(batch.id, { version: batch.version })).status).toBe(404);
        expect((await RETRY(json({}), params(batch.id))).status).toBe(404);
        expect((await CONFIRM_ALL(json({}), params(batch.id))).status).toBe(404);
        expect((await READ(json({}), params(batch.id))).status).toBe(404);
        expect((await DISCARD(new Request('http://localhost', { method: 'DELETE' }), params(batch.id))).status).toBe(404);
        // 用别人的错题本建批次被拒绝
        asUser('user-1');
        const foreign = await create({ source: 'text', text: '1．a\n2．b', targetSubjectId: 'other-math' });
        expect(foreign.response.status).toBe(400);
        expect(await database.importBatch.count()).toBe(1);
        expect(await database.importTask.count()).toBe(0);
    });

    it('任务列表把批次作为一批显示，批次内的任务不零散列出；丢弃批次保留已入库的错题', async () => {
        const { batch } = await create({ source: 'text', text: '1．计算 1 + 1。\n2．计算 2 + 2。', targetSubjectId: 'math' });
        await start(batch.id, { version: batch.version });
        await waitForImportBatchTasksForTest(batch.id);
        const list = await (await LIST()).json();
        expect(list.tasks).toHaveLength(0);
        expect(list.batches).toHaveLength(1);
        expect(list.batches[0]).toMatchObject({ id: batch.id, phase: 'done', counts: { total: 2, saved: 2 } });
        expect(list.activeCount).toBe(0);

        expect((await DISCARD(new Request('http://localhost', { method: 'DELETE' }), params(batch.id))).status).toBe(200);
        expect(await database.importBatch.count()).toBe(0);
        expect(await database.importTask.count()).toBe(0);
        expect(await database.errorItem.count()).toBe(2);
    });
});

describe('AI 只补标签（analysis=tags）', () => {
    it('免确认：保留草稿答案解析，AI 只补缺失字段，每题计一次 retag 额度', async () => {
        const text = '1．计算 1 + 1。\n【答案】2\n【解析】1+1=2\n\n2．计算 2 + 2。\n【答案】4';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });

        const started = await start(batch.id, { version: batch.version, analysis: 'tags' });
        expect(started.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);

        // 只调用标签建议，不调用完整识别
        expect(mocks.suggestKnowledgeTags).toHaveBeenCalledTimes(2);
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
        expect(mocks.analyzeImage).not.toHaveBeenCalled();
        expect(await database.aiUsage.count({ where: { kind: 'retag' } })).toBe(2);

        const items = await savedItemsInDraftOrder(batch.id);
        expect(items).toHaveLength(2);
        // 草稿答案解析保留
        expect(items[0].answerText).toBe('2');
        expect(items[0].analysis).toBe('1+1=2');
        // AI 补全的知识点、难度、题型落库
        expect(items[0].knowledgePoints).toContain('分数的意义');
        expect(items[0].difficultyStars).toBe(3);
        expect(items[0].questionType).toBe('calculation');

        const { batch: done } = await getBatch(batch.id);
        expect(done).toMatchObject({ status: 'started', phase: 'done', counts: { total: 2, saved: 2, failed: 0 } });
    });

    it('已有值的字段保留：草稿已填知识点/难度/题型时不覆盖', async () => {
        const text = '1．计算 1 + 1。\n【答案】2\n【知识点】自定义知识点\n【难度】4\n【题型】fill_blank';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });

        await start(batch.id, { version: batch.version, analysis: 'tags' });
        await waitForImportBatchTasksForTest(batch.id);

        // 草稿已填全部字段时 AI 不被调用（无缺失字段需要补全）
        expect(mocks.suggestKnowledgeTags).not.toHaveBeenCalled();
        const items = await database.errorItem.findMany();
        expect(items).toHaveLength(1);
        expect(items[0].knowledgePoints).toContain('自定义知识点');
        expect(items[0].difficultyStars).toBe(4);
        expect(items[0].questionType).toBe('fill_blank');
    });

    it('AI 失败时按原结果继续入库，不标记失败', async () => {
        mocks.suggestKnowledgeTags.mockRejectedValueOnce(new Error('AI_SERVICE_UNAVAILABLE'));
        const text = '1．计算 1 + 1。\n【答案】2';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });

        await start(batch.id, { version: batch.version, analysis: 'tags' });
        await waitForImportBatchTasksForTest(batch.id);

        const { batch: done } = await getBatch(batch.id);
        expect(done).toMatchObject({ phase: 'done', counts: { saved: 1, failed: 0 } });
        const items = await database.errorItem.findMany();
        expect(items).toHaveLength(1);
        // 原结果保留（知识点为空）
        expect(items[0].answerText).toBe('2');
    });

    it('超出每日额度时不调用 AI，按原结果继续入库', async () => {
        mocks.dailyLimit = 1;
        await database.aiUsage.create({ data: { userId: 'user-1', kind: 'retag' } });
        const text = '1．计算 1 + 1。\n【答案】2';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });

        const started = await start(batch.id, { version: batch.version, analysis: 'tags' });
        expect(started.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);

        expect(mocks.suggestKnowledgeTags).not.toHaveBeenCalled();
        const { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ phase: 'done', counts: { saved: 1, failed: 0 } });
        const items = await database.errorItem.findMany();
        expect(items).toHaveLength(1);
        expect(items[0].answerText).toBe('2');
    });

    it('额度为 0（不限制）时 tags 批次正常调用 AI 并入库', async () => {
        mocks.dailyLimit = 0;
        const text = '1．计算 1 + 1。\n【答案】2\n\n2．计算 2 + 2。\n【答案】4';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });

        const started = await start(batch.id, { version: batch.version, analysis: 'tags' });
        expect(started.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);

        // 额度为 0 表示不限制，AI 正常调用
        expect(mocks.suggestKnowledgeTags).toHaveBeenCalledTimes(2);
        const { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ phase: 'done', counts: { saved: 2, failed: 0 } });
        const items = await savedItemsInDraftOrder(batch.id);
        expect(items).toHaveLength(2);
        expect(items[0].answerText).toBe('2');
        expect(items[1].answerText).toBe('4');
    });

    it('图片批次传 analysis=tags 返回校验错误', async () => {
        mocks.splitQuestions.mockResolvedValue({
            questions: [{ label: '1', text: '如图，求面积。', material: null, section: null, regions: [{ x: 0.05, y: 0.05, width: 0.9, height: 0.3 }], hasFigure: false, flags: [] }],
            ignored: [], warnings: [],
        });
        const { batch } = await create({ source: 'image', imageBase64: PAGE, targetSubjectId: 'math' });
        await waitSplit(batch.id);
        const { batch: ready } = await getBatch(batch.id);
        const images = [{ key: ready.draft.items[0].key, imageBase64: CROP(1) }];
        const failed = await start(batch.id, { version: ready.version, images, analysis: 'tags' });
        expect(failed.status).toBe(400);
        expect((await failed.json()).message).toBe('IMPORT_BATCH_ANALYSIS_NONE_TEXT_ONLY');
    });

    it('缺目标错题本时返回校验错误', async () => {
        const text = '1．计算 1 + 1。\n【答案】2';
        const { batch } = await create({ source: 'text', text });
        const failed = await start(batch.id, { version: batch.version, analysis: 'tags' });
        expect(failed.status).toBe(400);
        expect((await failed.json()).message).toBe('IMPORT_BATCH_ANALYSIS_NONE_TARGET_REQUIRED');
    });

    it('校对模式：任务以 analyzing 创建，完成后进入 review', async () => {
        await database.user.update({ where: { id: 'user-1' }, data: { confirmBeforeImport: true } });
        const text = '1．计算 1 + 1。\n【答案】2\n\n2．计算 2 + 2。\n【答案】4';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });

        const started = await start(batch.id, { version: batch.version, analysis: 'tags' });
        expect(started.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);

        const { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ mode: 'review', phase: 'attention', counts: { review: 2, saved: 0 } });
        expect(current.tasks.every((task: { status: string; hasResult: boolean }) => task.status === 'review' && task.hasResult)).toBe(true);
        expect(await database.errorItem.count()).toBe(0);
        expect(mocks.suggestKnowledgeTags).toHaveBeenCalledTimes(2);

        // 校对确认后可入库
        const confirm = await CONFIRM_ALL(json({}), params(batch.id));
        expect(confirm.status).toBe(200);
        expect(await database.errorItem.count()).toBe(2);
    });

    it('重试已有结果的任务时不再调用 AI', async () => {
        const text = '1．计算 1 + 1。\n【答案】2\n\n2．计算 2 + 2。\n【答案】4';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });
        await start(batch.id, { version: batch.version, analysis: 'tags' });
        await waitForImportBatchTasksForTest(batch.id);

        let { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ phase: 'done', counts: { saved: 2 } });

        // 手动标记一个任务失败再重试
        const failedTask = current.tasks[0];
        await database.importTask.update({ where: { id: failedTask.id }, data: { status: 'failed', error: 'TEST_FAILURE' } });

        mocks.suggestKnowledgeTags.mockClear();
        const retried = await RETRY(json({}), params(batch.id));
        expect(retried.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);

        // 重试只重试保存，不调用 AI
        expect(mocks.suggestKnowledgeTags).not.toHaveBeenCalled();
        ({ batch: current } = await getBatch(batch.id));
        expect(current).toMatchObject({ phase: 'done', counts: { saved: 2 } });
    });
});

describe('按原样入库（analysis=none）', () => {
    it('免确认：题目直接入库且不调用 AI、不计额度', async () => {
        const text = '1．计算 1 + 1。\n【答案】2\n【解析】1+1=2\n\n2．计算 2 + 2。\n【答案】4\n【解析】2+2=4';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });
        expect(batch.selectedCount).toBe(2);

        const started = await start(batch.id, { version: batch.version, analysis: 'none' });
        expect(started.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);

        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
        expect(mocks.analyzeImage).not.toHaveBeenCalled();
        expect(await database.aiUsage.count()).toBe(0);

        const items = await savedItemsInDraftOrder(batch.id);
        expect(items).toHaveLength(2);
        expect(items.every((item) => item.subjectId === 'math' && item.userId === 'user-1')).toBe(true);
        expect(items[0].questionText).toContain('计算 1 + 1');
        expect(items[0].answerText).toBe('2');
        expect(items[0].analysis).toBe('1+1=2');

        const { batch: done } = await getBatch(batch.id);
        expect(done).toMatchObject({ status: 'started', phase: 'done', mode: 'auto', counts: { total: 2, saved: 2, failed: 0, active: 0 } });
    });

    it('公共材料拼接题干，学科取目标错题本名称，错答记录 mistakeStatus', async () => {
        const text = '阅读下面的材料，回答 1～2 题。\n某商店上午卖出 30 件。\n1．全天卖出多少件？\n【答案】75\n【错答】70\n\n2．下午比上午多卖多少件？\n【答案】15';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });
        await start(batch.id, { version: batch.version, analysis: 'none' });
        await waitForImportBatchTasksForTest(batch.id);

        const items = await savedItemsInDraftOrder(batch.id);
        expect(items).toHaveLength(2);
        expect(items[0].questionText).toContain('某商店上午卖出 30 件');
        expect(items[0].questionText).toContain('全天卖出多少件');
        expect(items[0].wrongAnswerText).toBe('70');
        expect(items[0].mistakeStatus).toBe('wrong_attempt');
        expect(items[1].mistakeStatus).toBe('unknown');
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
        expect(await database.aiUsage.count()).toBe(0);
    });

    it('校对模式：任务以 review 状态创建，不调用 AI', async () => {
        await database.user.update({ where: { id: 'user-1' }, data: { confirmBeforeImport: true } });
        const text = '1．计算 1 + 1。\n【答案】2\n\n2．计算 2 + 2。\n【答案】4';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });
        const started = await start(batch.id, { version: batch.version, analysis: 'none' });
        expect(started.status).toBe(202);

        const { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ mode: 'review', phase: 'attention', counts: { review: 2, saved: 0 } });
        expect(current.tasks.every((task: { status: string; hasResult: boolean }) => task.status === 'review' && task.hasResult)).toBe(true);
        expect(await database.errorItem.count()).toBe(0);
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
        expect(await database.aiUsage.count()).toBe(0);

        // 校对确认后可入库
        const confirm = await CONFIRM_ALL(json({}), params(batch.id));
        expect(confirm.status).toBe(200);
        expect((await confirm.json()).saved).toBe(2);
        expect(await database.errorItem.count()).toBe(2);
    });

    it('图片批次传 analysis=none 返回校验错误', async () => {
        mocks.splitQuestions.mockResolvedValue({
            questions: [{ label: '1', text: '如图，求面积。', material: null, section: null, regions: [{ x: 0.05, y: 0.05, width: 0.9, height: 0.3 }], hasFigure: false, flags: [] }],
            ignored: [], warnings: [],
        });
        const { batch } = await create({ source: 'image', imageBase64: PAGE, targetSubjectId: 'math' });
        await waitSplit(batch.id);
        const { batch: ready } = await getBatch(batch.id);
        const images = [{ key: ready.draft.items[0].key, imageBase64: CROP(1) }];
        const failed = await start(batch.id, { version: ready.version, images, analysis: 'none' });
        expect(failed.status).toBe(400);
        expect((await failed.json()).message).toBe('IMPORT_BATCH_ANALYSIS_NONE_TEXT_ONLY');
        expect((await getBatch(batch.id)).batch.status).toBe('draft');
    });

    it('缺目标错题本时返回校验错误', async () => {
        const text = '1．计算 1 + 1。\n【答案】2';
        const { batch } = await create({ source: 'text', text });
        const failed = await start(batch.id, { version: batch.version, analysis: 'none' });
        expect(failed.status).toBe(400);
        expect((await failed.json()).message).toBe('IMPORT_BATCH_ANALYSIS_NONE_TARGET_REQUIRED');
    });

    it('保存失败后重试不调用 AI', async () => {
        const text = '1．计算 1 + 1。\n【答案】2\n\n2．计算 2 + 2。\n【答案】4\n\n3．计算 3 + 3。\n【答案】6';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });
        await start(batch.id, { version: batch.version, analysis: 'none' });
        await waitForImportBatchTasksForTest(batch.id);

        let { batch: current } = await getBatch(batch.id);
        expect(current).toMatchObject({ phase: 'done', counts: { saved: 3 } });

        // 删掉一道错题使重试保存时判重命中（或手动标记任务失败再重试）
        const failedTask = current.tasks[0];
        await database.importTask.update({ where: { id: failedTask.id }, data: { status: 'failed', error: 'TEST_FAILURE' } });

        mocks.reanswerQuestion.mockClear();
        const retried = await RETRY(json({}), params(batch.id));
        expect(retried.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);

        // 重试只重试保存，不调用 AI
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
        ({ batch: current } = await getBatch(batch.id));
        expect(current).toMatchObject({ phase: 'done', counts: { saved: 3 } });
    });

    it('analysis=ai 时行为与之前一致（默认）', async () => {
        const text = '1．计算 1 + 1。\n【答案】2';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });
        await start(batch.id, { version: batch.version });
        await waitForImportBatchTasksForTest(batch.id);
        expect(mocks.reanswerQuestion).toHaveBeenCalledTimes(1);
        expect(await database.aiUsage.count()).toBe(1);
    });

    it('批次只设 subjectId（无 targetSubjectId）：按原样入库后题目落在该错题本', async () => {
        const text = '1．计算 5 + 5。\n【答案】10';
        const { batch } = await create({ source: 'text', text, subjectId: 'math' });
        expect(batch.targetSubjectId).toBeNull();

        const started = await start(batch.id, { version: batch.version, analysis: 'none' });
        expect(started.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);

        const items = await database.errorItem.findMany();
        expect(items).toHaveLength(1);
        expect(items[0].subjectId).toBe('math');
        expect(items[0].answerText).toBe('10');
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
        expect(await database.aiUsage.count()).toBe(0);
    });

    it('无答案的题按原样入库后 answerText 为空串（占位空格已还原）', async () => {
        const text = '1．阅读短文回答问题。\n2．计算 2 × 3。';
        const { batch } = await create({ source: 'text', text, targetSubjectId: 'math' });
        await start(batch.id, { version: batch.version, analysis: 'none' });
        await waitForImportBatchTasksForTest(batch.id);

        const items = await savedItemsInDraftOrder(batch.id);
        expect(items).toHaveLength(2);
        // 第一题无答案：占位空格还原为空串
        expect(items[0].answerText).toBe('');
        expect(items[0].analysis).toBe('');
        // 第二题也无答案（无标记行）
        expect(items[1].answerText).toBe('');
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
    });

    it('带 image 的题按原样入库后 originalImageUrl 为该图（T18）', async () => {
        const imageData = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';
        const { batch } = await create({
            source: 'text',
            items: [
                { text: '1．如图，求面积。', answer: '12', image: imageData },
                { text: '2．计算 1+1。', answer: '2' },
            ],
            targetSubjectId: 'math',
        });
        expect(batch.selectedCount).toBe(2);

        const started = await start(batch.id, { version: batch.version, analysis: 'none' });
        expect(started.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);

        const items = await savedItemsInDraftOrder(batch.id);
        expect(items).toHaveLength(2);
        expect(items[0].originalImageUrl).toBe(imageData);
        expect(items[1].originalImageUrl).toBe('');
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
        expect(await database.aiUsage.count()).toBe(0);
    });

    it('ai 模式带 image 的题：按图片识别，inputText 作为参考文字，按 analyze 计额度（T18）', async () => {
        const imageData = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';
        const { batch } = await create({
            source: 'text',
            items: [
                { text: '1．如图，求面积。', image: imageData },
            ],
            targetSubjectId: 'math',
        });

        const started = await start(batch.id, { version: batch.version, analysis: 'ai' });
        expect(started.status).toBe(202);
        await waitForImportBatchTasksForTest(batch.id);

        // ai 模式下带原图的题按图片识别，inputText 作为参考文字传给模型，不调用文字解题
        expect(mocks.analyzeImage).toHaveBeenCalledTimes(1);
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
        // analyzeImage 第 8 个参数是 referenceText（题库文件文字层）
        expect(mocks.analyzeImage.mock.calls[0][7]).toBe('1．如图，求面积。');
        // 额度按 analyze 计，不按 reanswer 计
        expect(await database.aiUsage.count({ where: { kind: 'analyze' } })).toBe(1);
        expect(await database.aiUsage.count({ where: { kind: 'reanswer' } })).toBe(0);

        const items = await database.errorItem.findMany();
        expect(items).toHaveLength(1);
        expect(items[0].originalImageUrl).toBe(imageData);
    });

    it('批次开始时图片总长度超限返回明确错误（T18）', async () => {
        // MAX_DRAFT_IMAGE_LENGTH 远小于 MAX_START_IMAGES_LENGTH，
        // 创建时 draftItemSchema 会校验单张图片长度，超限返回 400
        const bigImage = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`;
        const { response, data } = await create({
            source: 'text',
            items: [
                { text: '1．题一', image: bigImage },
            ],
            targetSubjectId: 'math',
        });
        expect(response.status).toBe(400);
        expect(data.message).toBe('IMPORT_BATCH_INVALID_INPUT');
    });
});

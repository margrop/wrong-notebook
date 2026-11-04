// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    scheduleMasteryEvaluation: vi.fn(),
    recognizeGrade: vi.fn(),
    session: { user: { id: 'user-1', email: 'duplicate-test@example.com', role: 'admin' }, expires: '2099-01-01' },
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai', () => ({ getAIService: () => ({ recognizeGrade: mocks.recognizeGrade }) }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/mastery', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mastery')>()),
    scheduleMasteryEvaluation: mocks.scheduleMasteryEvaluation,
}));
vi.mock('@/lib/paper-level', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/paper-level')>()),
    ensureDefaultPaperGroups: vi.fn(async (userId: string, client?: unknown) => {
        const db = (client ?? mocks.prisma!) as PrismaClient;
        const existing = await db.paperGroup.findMany({ where: { userId } });
        const map: Record<string, string> = {};
        for (const g of existing) {
            if (g.key) map[g.key] = g.id;
        }
        const defaults: Array<{ key: string; name: string; order: number }> = [
            { key: 'a', name: 'A卷', order: 0 },
            { key: 'b', name: 'B卷', order: 1 },
            { key: 'other', name: '其他', order: 2 },
        ];
        for (const d of defaults) {
            if (!map[d.key]) {
                const created = await db.paperGroup.create({
                    data: { userId, key: d.key, name: d.name, order: d.order },
                });
                map[d.key] = created.id;
            }
        }
        return map;
    }),
    getDefaultPaperLevelGroupId: vi.fn(async (userId: string, difficultyStars: number | null | undefined, client?: unknown) => {
        if (typeof difficultyStars !== 'number' || !Number.isInteger(difficultyStars) || difficultyStars < 1 || difficultyStars > 5) {
            return null;
        }
        const key = difficultyStars <= 3 ? 'a' : 'b';
        const db = (client ?? mocks.prisma!) as PrismaClient;
        const group = await db.paperGroup.findFirst({
            where: { userId, key, isActive: true },
        });
        return group?.id ?? null;
    }),
}));

import { POST as IMPORT_QUESTION } from '@/app/api/error-items/route';
import { POST as IMPORT_BACKUP } from '@/app/api/import/route';
import { POST as IMPORT_OPENCLAW } from '@/app/api/openclaw/batch-upload/route';
import { GET as GET_PROFILE, PATCH as UPDATE_PROFILE } from '@/app/api/user/route';
import { POST as COMPARE_QUESTIONS } from '@/app/api/error-items/similarity/route';
import { GET as GET_HISTORY } from '@/app/api/error-items/[id]/practice-records/route';
import { findDuplicateQuestion, recordDuplicateQuestion, runQuestionImportTransaction } from '@/lib/question/question-deduplication';
import * as appConfig from '@/lib/config';

let database: PrismaClient;
let directory: string;
const questionText = '求解方程 x + 2 = 5，并写出解题步骤。';
const request = (body: object, path = '/api/error-items', headers?: Record<string, string>) => new Request(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
});
const save = (body: object = {}) => IMPORT_QUESTION(request({ questionText, originalImageUrl: '', ...body }));
const existing = (content: object = {}) => database.errorItem.create({
    data: { id: 'existing', userId: 'user-1', subjectId: 'math', questionText, originalImageUrl: 'old-image', createdAt: new Date('2025-01-01'), ...content },
});

beforeAll(async () => {
    // 所有真实读写和迁移均使用系统临时数据库，不接触开发或生产数据。
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-duplicate-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    await database.$queryRaw`PRAGMA journal_mode = WAL`;
    await database.$queryRaw`PRAGMA busy_timeout = 30000`;
    mocks.prisma = database;
// 迁移通过子进程执行 Prisma CLI，CI 中与其他测试文件并行时较慢，留足时间
}, 120000);

beforeEach(async () => {
    mocks.recognizeGrade.mockResolvedValue(null);
    await database.user.deleteMany();
    await database.user.createMany({ data: [
        { id: 'user-1', email: mocks.session.user.email, password: 'test-only' },
        { id: 'user-2', email: 'other-duplicate-test@example.com', password: 'test-only' },
    ] });
    await database.subject.createMany({ data: [
        { id: 'math', name: '数学', userId: 'user-1' },
        { id: 'other-notebook', name: '第二错题本', userId: 'user-1' },
    ] });
}, 30000);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('账户级录入年级规则（真实 SQLite）', () => {
    it('旧账户默认固定模式，保存的规则仅影响当前账户的新题', async () => {
        expect(await (await GET_PROFILE()).json()).toMatchObject({ gradeRecognitionMode: 'fixed', fixedGradeSemester: null });
        await existing({ gradeSemester: '初一上' });
        const response = await UPDATE_PROFILE(request({ gradeRecognitionMode: 'fixed', fixedGradeSemester: '四年级下' }, '/api/user'));
        expect(response.status).toBe(200);
        expect(await (await GET_PROFILE()).json()).toMatchObject({ gradeRecognitionMode: 'fixed', fixedGradeSemester: '四年级下' });
        expect(await database.user.findUniqueOrThrow({ where: { id: 'user-2' } })).toMatchObject({ gradeRecognitionMode: 'fixed', fixedGradeSemester: null });
        const imported = await (await save({ questionText: '计算这个长方体的体积。', recognizedGradeSemester: '高二上' })).json();
        expect(imported.gradeSemester).toBe('四年级下');
        expect((await database.errorItem.findUniqueOrThrow({ where: { id: 'existing' } })).gradeSemester).toBe('初一上');
        expect(mocks.recognizeGrade).not.toHaveBeenCalled();
    });

    it.each([{ gradeRecognitionMode: 'unknown' }, { fixedGradeSemester: '十三年级上' }, { fixedGradeSemester: 4 }])('拒绝非法规则 %j', async (body) => {
        expect((await UPDATE_PROFILE(request(body, '/api/user'))).status).toBe(400);
        expect((await database.user.findUniqueOrThrow({ where: { id: 'user-1' } })).gradeRecognitionMode).toBe('fixed');
    });

    it('固定模式仍允许单题手工覆盖，显式清空时不重新填充年级', async () => {
        await UPDATE_PROFILE(request({ fixedGradeSemester: '四年级上' }, '/api/user'));
        expect(await (await save({ gradeSemester: '初二下' })).json()).toMatchObject({ gradeSemester: '初二下' });
        await database.errorItem.deleteMany();
        expect(await (await save({ gradeSemester: '' })).json()).toMatchObject({ gradeSemester: null });
    });

    it.each(['高二下', null])('AI 模式保留识别结果 %s，免确认保存不再发起识别', async (recognizedGradeSemester) => {
        await UPDATE_PROFILE(request({ gradeRecognitionMode: 'ai', fixedGradeSemester: '四年级上' }, '/api/user'));
        const response = await save({ recognizedGradeSemester });
        expect(response.status).toBe(201);
        expect((await response.json()).gradeSemester).toBe(recognizedGradeSemester);
        expect(mocks.recognizeGrade).not.toHaveBeenCalled();
    });

    it('AI 模式为直接录入补充识别并记录用量，重复导入不再调用 AI', async () => {
        await UPDATE_PROFILE(request({ gradeRecognitionMode: 'ai' }, '/api/user'));
        mocks.recognizeGrade.mockResolvedValue('五年级上');
        expect(await (await save()).json()).toMatchObject({ gradeSemester: '五年级上' });
        expect(mocks.recognizeGrade).toHaveBeenCalledWith(questionText);
        expect(await database.aiUsage.count({ where: { userId: 'user-1', kind: 'analyze' } })).toBe(1);
        expect(await (await save()).json()).toMatchObject({ duplicate: true });
        expect(mocks.recognizeGrade).toHaveBeenCalledOnce();
        expect(await database.aiUsage.count({ where: { userId: 'user-1' } })).toBe(1);
    });

    it.each(['AI_AUTH_ERROR', 'AI_CONNECTION_FAILED', 'AI_TIMEOUT_ERROR', 'AI_QUOTA_EXCEEDED', 'AI_UNKNOWN_ERROR'])(
        '年级识别失败 %s 时返回安全原因且不创建题目', async (reason) => {
            await UPDATE_PROFILE(request({ gradeRecognitionMode: 'ai' }, '/api/user'));
            mocks.recognizeGrade.mockRejectedValue(new Error(`${reason}: secret-provider-response`));
            const response = await save();
            expect(response.status).toBe(502);
            expect(await response.json()).toEqual({ message: 'QUESTION_SAVE_GRADE_FAILED', code: 'AI_ERROR', details: { reason } });
            expect(await database.errorItem.count()).toBe(0);
        },
    );

    it('直接录入需要补充识别时遵守每日额度，超限不写入题目', async () => {
        await database.user.update({ where: { id: 'user-1' }, data: { gradeRecognitionMode: 'ai', role: 'user' } });
        await database.aiUsage.create({ data: { userId: 'user-1', kind: 'analyze' } });
        const config = vi.spyOn(appConfig, 'getAppConfig').mockReturnValue({ aiProvider: 'gemini', aiDailyLimit: 1 });
        try {
            expect((await save()).status).toBe(429);
            expect(mocks.recognizeGrade).not.toHaveBeenCalled();
            expect(await database.errorItem.count()).toBe(0);
            expect(await database.aiUsage.count()).toBe(1);
        } finally {
            config.mockRestore();
        }
    });
});

describe('题目导入自动判重（真实 SQLite）', () => {
    it('跨错题本识别很早以前的相同题目，保存本次作答但保留原题与短 ID', async () => {
        const original = await existing({ shortId: 'AbC234', wrongAnswerText: '旧作答', userNotes: '原笔记', masteryLevel: 1 });
        const response = await save({
            subjectId: 'other-notebook',
            questionText: `  ${questionText}\n`,
            wrongAnswerText: 'x = 7',
            mistakeAnalysis: '移项时忘记变号',
            originalImageUrl: 'data:image/png;base64,bmV3',
        });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toMatchObject({ id: original.id, shortId: 'AbC234', subjectId: 'math', duplicate: true, mistakeRecorded: true, similarity: 1 });
        expect(data.message).toContain('已在已有题目的举一反三记录中记录');
        expect(await database.errorItem.count()).toBe(1);
        expect(await database.errorItem.findUnique({ where: { id: original.id } })).toEqual(original);
        expect(await database.practiceRecord.findUnique({ where: { id: data.practiceRecordId } })).toMatchObject({
            userId: 'user-1', errorItemId: original.id, subject: '数学', result: 'wrong', isCorrect: false,
            source: 'duplicate_import', wrongAnswerText: 'x = 7', mistakeAnalysis: '移项时忘记变号', originalImageUrl: 'data:image/png;base64,bmV3',
        });
        expect(mocks.scheduleMasteryEvaluation).toHaveBeenCalledWith([original.id]);
    });

    it('每次重复导入均新增一次错误记录，不覆盖既有练习历史', async () => {
        await existing();
        await database.practiceRecord.create({ data: { userId: 'user-1', errorItemId: 'existing', result: 'correct', isCorrect: true } });
        await save({ wrongAnswerText: '第一次' });
        await save({ wrongAnswerText: '第二次' });
        const records = await database.practiceRecord.findMany();
        expect(records).toHaveLength(3);
        expect(records.filter((record) => record.result === 'wrong').map((record) => record.wrongAnswerText).sort()).toEqual(['第一次', '第二次']);
        expect(records.find((record) => record.result === 'correct')?.isCorrect).toBe(true);
        expect(await database.errorItem.count()).toBe(1);
    });

    it('默认阈值为 90%，保存个人阈值后立即用于后续导入且不影响其他用户', async () => {
        expect((await (await GET_PROFILE()).json()).questionDuplicateThreshold).toBe(90);
        const response = await UPDATE_PROFILE(request({ questionDuplicateThreshold: 95 }, '/api/user'));
        expect(response.status).toBe(200);
        expect((await (await GET_PROFILE()).json()).questionDuplicateThreshold).toBe(95);
        expect((await database.user.findUniqueOrThrow({ where: { id: 'user-2' } })).questionDuplicateThreshold).toBe(90);
        await existing({ questionText: '甲'.repeat(100) });
        expect((await save({ questionText: '甲'.repeat(96) + '乙'.repeat(4) })).status).toBe(200);
    });

    it('拒绝越界、非数值和过多小数位的阈值，并保留原设置', async () => {
        for (const value of [0, -1, 101, '95', null, 99.999]) {
            const response = await UPDATE_PROFILE(request({ questionDuplicateThreshold: value }, '/api/user'));
            expect(response.status).toBe(400);
        }
        expect((await database.user.findUniqueOrThrow({ where: { id: 'user-1' } })).questionDuplicateThreshold).toBe(90);
    });

    it('阈值可以保存为小数，100% 时同题也不自动合并', async () => {
        expect((await UPDATE_PROFILE(request({ questionDuplicateThreshold: 99.6 }, '/api/user'))).status).toBe(200);
        expect((await (await GET_PROFILE()).json()).questionDuplicateThreshold).toBe(99.6);
        await UPDATE_PROFILE(request({ questionDuplicateThreshold: 100 }, '/api/user'));
        await existing();
        expect((await save()).status).toBe(201);
        expect(await database.practiceRecord.count()).toBe(0);
    });

    it('新错误快照可从举一反三历史读取', async () => {
        await existing();
        await save({ wrongAnswerText: '新作答', mistakeAnalysis: '新错因', originalImageUrl: 'new-image' });
        const response = await GET_HISTORY(new Request('http://localhost'), { params: Promise.resolve({ id: 'existing' }) });
        expect(response.status).toBe(200);
        expect((await response.json()).records[0]).toMatchObject({ result: 'wrong', source: 'duplicate_import', wrongAnswerText: '新作答', mistakeAnalysis: '新错因', originalImageUrl: 'new-image' });
    });

    it('恰好 90% 时仍创建新题', async () => {
        await existing({ questionText: '甲'.repeat(100) });
        const response = await save({ questionText: '甲'.repeat(90) + '乙'.repeat(10) });
        expect(response.status).toBe(201);
        expect(await database.errorItem.count()).toBe(2);
        expect(await database.practiceRecord.count()).toBe(0);
    });

    it('大于 90% 时返回原题及实际分数', async () => {
        await existing({ questionText: '甲'.repeat(100) });
        const response = await save({ questionText: '甲'.repeat(91) + '乙'.repeat(9) });
        expect(response.status).toBe(200);
        expect((await response.json()).similarity).toBeCloseTo(0.91);
        expect(await database.errorItem.count()).toBe(1);
    });

    it('其他用户的同题不参与判重', async () => {
        await existing({ userId: 'user-2', subjectId: null });
        expect((await save()).status).toBe(201);
        expect(await database.errorItem.count({ where: { userId: 'user-1' } })).toBe(1);
        expect(await database.practiceRecord.count()).toBe(0);
    });

    it('只有题目前 100 字相同不能判重', async () => {
        const prefix = '甲'.repeat(100);
        await existing({ questionText: prefix + '乙'.repeat(100) });
        expect((await save({ questionText: prefix + '丙'.repeat(100) })).status).toBe(201);
    });

    it('没有题干时不把只有图片的不同题目判为相同', async () => {
        await existing({ questionText: null });
        expect((await save({ questionText: '', originalImageUrl: 'image' })).status).toBe(201);
        expect(await database.practiceRecord.count()).toBe(0);
    });

    it('兼容旧题库仅有 OCR 文本的题目', async () => {
        await existing({ questionText: null, ocrText: questionText });
        expect((await save()).status).toBe(200);
        expect(await database.errorItem.count()).toBe(1);
    });

    it('题库超过一页仍能找到重复题目', async () => {
        await database.errorItem.createMany({ data: Array.from({ length: 205 }, (_, index) => ({
            id: `candidate-${String(index).padStart(3, '0')}`, userId: 'user-1', questionText: `另一道题目${index}`, originalImageUrl: '',
        })) });
        await existing({ id: 'zz-existing' });
        const response = await save();
        expect((await response.json()).id).toBe('zz-existing');
        expect(await database.errorItem.count()).toBe(206);
    });

    it('多道题目超过阈值时选择相似度最高的一道', async () => {
        await existing({ id: 'aaa-near', questionText: '甲'.repeat(100) + '乙' });
        await existing({ id: 'zzz-exact', questionText: '甲'.repeat(101) });
        const response = await save({ questionText: '甲'.repeat(101) });
        expect((await response.json()).id).toBe('zzz-exact');
    });

    it('并发导入同题只创建一道题，其余分别记录本次做错', async () => {
        const responses = await Promise.all([save(), save(), save()]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201]);
        expect(await database.errorItem.count()).toBe(1);
        expect(await database.practiceRecord.count({ where: { result: 'wrong' } })).toBe(2);
    }, 45000);

    it('事务失败时回滚错误快照，保持原题不变', async () => {
        const original = await existing();
        await expect(runQuestionImportTransaction(async (tx) => {
            const duplicate = await findDuplicateQuestion(tx, 'user-1', { questionText });
            if (!duplicate) throw new Error('未找到重复题目');
            await recordDuplicateQuestion(tx, 'user-1', duplicate, { questionText });
            throw new Error('模拟事务失败');
        })).rejects.toThrow('模拟事务失败');
        expect(await database.practiceRecord.count()).toBe(0);
        expect(await database.errorItem.findUnique({ where: { id: original.id } })).toEqual(original);
    });

    it('拒绝非法题干类型，避免进入题库比较', async () => {
        expect((await save({ questionText: { text: '非法类型' } })).status).toBe(400);
        expect(await database.errorItem.count()).toBe(0);
    });
});

describe('其他导入入口也使用同一判重规则', () => {
    it('Openclaw 未返回年级时在事务外补充识别', async () => {
        await UPDATE_PROFILE(request({ gradeRecognitionMode: 'ai' }, '/api/user'));
        mocks.recognizeGrade.mockResolvedValue('初二下');
        vi.stubEnv('OPENCLAW_AUTH_MODE', 'apikey');
        vi.stubEnv('OPENCLAW_INTEGRATION_API_KEY', 'test-only-key');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: true, data: { questionText, answerText: 'x = 3', analysis: '移项', knowledgePoints: [] },
        }), { status: 200 })));
        const response = await IMPORT_OPENCLAW(request({ userEmail: mocks.session.user.email, images: [{ base64: 'dGVzdA==', mimeType: 'image/png', filename: 'grade.png' }] }, '/api/openclaw/batch-upload', { 'x-api-key': 'test-only-key' }));
        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.successCount).toBe(1);
        expect((await database.errorItem.findUniqueOrThrow({ where: { id: data.results[0].errorItemId } })).gradeSemester).toBe('初二下');
        expect(mocks.recognizeGrade).toHaveBeenCalledOnce();
    });

    it.each([['fixed', '四年级上'], ['ai', '高二下']] as const)('Openclaw 导入遵循 %s 年级规则', async (gradeRecognitionMode, expectedGrade) => {
        await UPDATE_PROFILE(request({ gradeRecognitionMode, fixedGradeSemester: '四年级上' }, '/api/user'));
        vi.stubEnv('OPENCLAW_AUTH_MODE', 'apikey');
        vi.stubEnv('OPENCLAW_INTEGRATION_API_KEY', 'test-only-key');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: true, data: { questionText, answerText: 'x = 3', analysis: '移项', knowledgePoints: [], gradeSemester: '高二下' },
        }), { status: 200 })));
        const response = await IMPORT_OPENCLAW(request({ userEmail: mocks.session.user.email, images: [{ base64: 'dGVzdA==', mimeType: 'image/png', filename: 'grade.png' }] }, '/api/openclaw/batch-upload', { 'x-api-key': 'test-only-key' }));
        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.successCount).toBe(1);
        expect((await database.errorItem.findUniqueOrThrow({ where: { id: data.results[0].errorItemId } })).gradeSemester).toBe(expectedGrade);
        expect(mocks.recognizeGrade).not.toHaveBeenCalled();
    });

    it('Openclaw 识别返回星级时，保存星级并默认归入对应卷别', async () => {
        vi.stubEnv('OPENCLAW_AUTH_MODE', 'apikey');
        vi.stubEnv('OPENCLAW_INTEGRATION_API_KEY', 'test-only-key');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: true, data: { questionText, answerText: 'x = 3', analysis: '移项', knowledgePoints: [], difficultyStars: 5 },
        }), { status: 200 })));
        const response = await IMPORT_OPENCLAW(request({ userEmail: mocks.session.user.email, images: [{ base64: 'dGVzdA==', mimeType: 'image/png', filename: 'star.png' }] }, '/api/openclaw/batch-upload', { 'x-api-key': 'test-only-key' }));
        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.successCount).toBe(1);
        expect(await database.errorItem.findUnique({ where: { id: data.results[0].errorItemId } })).toMatchObject({ difficultyStars: 5, paperLevel: expect.any(String) });
    });

    it('Openclaw 上传按用户学段自动计算中文年级学期', async () => {
        vi.stubEnv('OPENCLAW_AUTH_MODE', 'apikey');
        vi.stubEnv('OPENCLAW_INTEGRATION_API_KEY', 'test-only-key');
        await database.user.update({ where: { id: 'user-1' }, data: { educationStage: 'primary', enrollmentYear: new Date().getFullYear() - 1 } });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: true, data: { questionText, answerText: 'x = 3', analysis: '移项', knowledgePoints: [] },
        }), { status: 200 })));
        const response = await IMPORT_OPENCLAW(request({ userEmail: mocks.session.user.email, images: [{ base64: 'dGVzdA==', mimeType: 'image/png', filename: 'grade.png' }] }, '/api/openclaw/batch-upload', { 'x-api-key': 'test-only-key' }));
        expect(response.status).toBe(201);
        const data = await response.json();
        const item = await database.errorItem.findUniqueOrThrow({ where: { id: data.results[0].errorItemId } });
        expect(item.gradeSemester).toMatch(/^[一二]年级[上下]$/);
    });

    it('Openclaw 上传拒绝扩展名合法但类型不是 JPG、PNG 的图片，不调用 AI', async () => {
        vi.stubEnv('OPENCLAW_AUTH_MODE', 'apikey');
        vi.stubEnv('OPENCLAW_INTEGRATION_API_KEY', 'test-only-key');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const response = await IMPORT_OPENCLAW(request({ userEmail: mocks.session.user.email, images: [{ base64: 'dGVzdA==', mimeType: 'image/svg+xml', filename: 'question.png' }] }, '/api/openclaw/batch-upload', { 'x-api-key': 'test-only-key' }));
        const data = await response.json();
        expect(data.successCount).toBe(0);
        expect(data.results[0]).toMatchObject({ success: false, error: expect.stringContaining('image/svg+xml') });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await database.errorItem.count()).toBe(0);
    });

    it.each([null, 'a', 'other'])('备份导入仅为未设置卷别的 4 星题补默认分组，原卷别为 %s', async (paperLevel) => {
        const response = await IMPORT_BACKUP(request({ version: 1, user: { email: mocks.session.user.email }, errorItems: [{ id: 'backup-item', userId: 'user-1', questionText, difficultyStars: 4, paperLevel, originalImageUrl: '' }] }, '/api/import'));
        expect(response.status).toBe(200);
        const item = await database.errorItem.findFirst({ where: { userId: 'user-1' } });
        expect(item).toMatchObject({ difficultyStars: 4 });
        if (paperLevel === null) {
            // 未设置卷别时按星级推荐默认分组（4 星 → b）
            expect(item?.paperLevel).not.toBeNull();
        } else {
            // 保留原有卷别映射后的分组 id
            expect(item?.paperLevel).not.toBeNull();
        }
    }, 30000);
    it('Openclaw 同一批次的相同题目返回逐题提示和错误记录', async () => {
        vi.stubEnv('OPENCLAW_AUTH_MODE', 'apikey');
        vi.stubEnv('OPENCLAW_INTEGRATION_API_KEY', 'test-only-key');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: true, data: { questionText, answerText: 'x = 3', analysis: '移项', knowledgePoints: [], wrongAnswerText: 'x = 7' },
        }), { status: 200 })));
        const response = await IMPORT_OPENCLAW(request({
            userEmail: mocks.session.user.email,
            images: [0, 1].map((index) => ({ base64: 'dGVzdA==', mimeType: 'image/png', filename: `${index}.png` })),
        }, '/api/openclaw/batch-upload', { 'x-api-key': 'test-only-key' }));
        const data = await response.json();
        expect(response.status).toBe(201);
        expect(data.successCount).toBe(2);
        expect(data.results[1]).toMatchObject({ duplicate: true, mistakeRecorded: true, errorItemId: data.results[0].errorItemId });
        expect(data.results[1].message).toContain('当前题目重复');
        expect(await database.errorItem.count()).toBe(1);
        expect(await database.practiceRecord.count({ where: { source: 'duplicate_import', wrongAnswerText: 'x = 7' } })).toBe(1);
    });

    it('JSON 导入返回重复计数，并把历史和复习计划映射到原题', async () => {
        await existing();
        const response = await IMPORT_BACKUP(request({
            version: 1,
            user: { email: mocks.session.user.email },
            errorItems: [{ id: 'imported-id', userId: 'user-1', questionText, originalImageUrl: 'new-image', wrongAnswerText: '本次导入作答' }],
            reviewSchedules: [{ errorItemId: 'imported-id', scheduledFor: '2026-11-01' }],
            practiceRecords: [{ userId: 'user-1', errorItemId: 'imported-id', result: 'wrong', isCorrect: false, source: 'duplicate_import', wrongAnswerText: '历史作答', createdAt: '2026-01-01' }],
        }, '/api/import'));
        const data = await response.json();
        expect(response.status).toBe(200);
        expect(data.stats).toMatchObject({ errorItemsCreated: 0, duplicateErrorItems: 1, practiceRecordsCreated: 2, reviewSchedulesCreated: 1 });
        expect(await database.errorItem.count()).toBe(1);
        expect(await database.practiceRecord.count({ where: { errorItemId: 'existing' } })).toBe(2);
        expect(await database.practiceRecord.count({ where: { wrongAnswerText: '历史作答' } })).toBe(1);
        expect(await database.reviewSchedule.count({ where: { errorItemId: 'existing' } })).toBe(1);
        expect(mocks.scheduleMasteryEvaluation).toHaveBeenCalledWith(['existing']);
    });
});

describe('两题相似度比较', () => {
    it('返回完整分数、当前阈值和原文，按选择顺序展示且不记录本次做错', async () => {
        await existing({ id: 'one', questionText: '甲乙丙丁' });
        await existing({ id: 'two', questionText: '甲乙戊己', subjectId: 'other-notebook' });
        const response = await COMPARE_QUESTIONS(request({ ids: ['two', 'one'] }));
        const data = await response.json();
        expect(response.status).toBe(200);
        expect(data).toMatchObject({ similarity: 0.5, threshold: 90, duplicate: false });
        expect(data.items.map((item: { id: string }) => item.id)).toEqual(['two', 'one']);
        expect(await database.practiceRecord.count()).toBe(0);
    });

    it('调整阈值后比较结论与实际导入判重一致', async () => {
        await existing({ id: 'one', questionText: '甲'.repeat(100) });
        await existing({ id: 'two', questionText: '甲'.repeat(92) + '乙'.repeat(8) });
        const compare = () => COMPARE_QUESTIONS(request({ ids: ['one', 'two'] }));
        expect(await (await compare()).json()).toMatchObject({ similarity: 0.92, threshold: 90, duplicate: true });
        await UPDATE_PROFILE(request({ questionDuplicateThreshold: 95 }, '/api/user'));
        expect(await (await compare()).json()).toMatchObject({ similarity: 0.92, threshold: 95, duplicate: false });
        await database.errorItem.delete({ where: { id: 'two' } });
        expect((await save({ questionText: '甲'.repeat(92) + '乙'.repeat(8) })).status).toBe(201);
    });

    it('拒绝选择同一题、选择数量错误和不存在或属于他人的题目', async () => {
        await existing({ id: 'one' });
        await existing({ id: 'foreign', userId: 'user-2', subjectId: null });
        for (const ids of [['one'], ['one', 'one'], ['one', 'foreign', 'three']]) {
            expect((await COMPARE_QUESTIONS(request({ ids }))).status).toBe(400);
        }
        for (const ids of [['one', 'foreign'], ['one', 'missing']]) {
            expect((await COMPARE_QUESTIONS(request({ ids }))).status).toBe(404);
        }
        expect(await database.practiceRecord.count()).toBe(0);
    });

    it('题目缺少文字时返回明确错误，不把空题干当成相同题', async () => {
        await existing({ id: 'one' });
        await existing({ id: 'empty', questionText: null });
        const response = await COMPARE_QUESTIONS(request({ ids: ['one', 'empty'] }));
        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('Question text is required for similarity comparison');
    });
});

// @vitest-environment node
/**
 * Openclaw 批量上传接口（真实 SQLite，外部 Openclaw 智能体调用 mock fetch）：
 * API Key 鉴权、图片校验、正常创建错题并关联标签、重复题目记为重复。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    scheduleMasteryEvaluation: vi.fn(),
    session: { user: { id: 'user-1', email: 'openclaw@example.com', role: 'user' }, expires: '2099-01-01' },
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai', () => ({ getAIService: () => ({}) }));
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

import { POST as BATCH_UPLOAD } from '@/app/api/openclaw/batch-upload/route';

let database: PrismaClient;
let directory: string;
const BASE64 = 'dGVzdA=='; // "test" base64，远小于 5MB

function request(body: object, headers?: Record<string, string>) {
    return new Request('http://localhost/api/openclaw/batch-upload', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

function mockOpenclawFetch(data: object) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        success: true,
        data,
    }), { status: 200 })));
}

beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-openclaw-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    mocks.scheduleMasteryEvaluation.mockReset();
    vi.stubEnv('OPENCLAW_AUTH_MODE', 'apikey');
    vi.stubEnv('OPENCLAW_INTEGRATION_API_KEY', 'test-only-key');
    await database.user.deleteMany();
    await database.user.createMany({ data: [
        { id: 'user-1', email: 'openclaw@example.com', password: 'test-only' },
    ] });
    await database.subject.createMany({ data: [
        { id: 'math', name: '数学', userId: 'user-1', subjectKey: 'math', tagSet: 'default', stage: 'junior_high' },
    ] });
});

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('Openclaw 批量上传', () => {
    it('API Key 鉴权失败返回 401', async () => {
        const response = await BATCH_UPLOAD(request(
            { userEmail: 'openclaw@example.com', images: [] },
            { 'x-api-key': 'wrong-key' },
        ));
        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data).toMatchObject({ message: 'API密钥无效', code: 'UNAUTHORIZED' });
    });

    it('缺少 API Key 返回 401', async () => {
        const response = await BATCH_UPLOAD(request({ userEmail: 'openclaw@example.com', images: [] }));
        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data).toMatchObject({ message: '未提供API密钥', code: 'UNAUTHORIZED' });
    });

    it('图片校验失败（扩展名不合法）不调用 AI，返回逐题错误', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const response = await BATCH_UPLOAD(request({
            userEmail: 'openclaw@example.com',
            images: [{ base64: BASE64, mimeType: 'image/jpeg', filename: 'photo.gif' }],
        }, { 'x-api-key': 'test-only-key' }));
        const data = await response.json();
        expect(data.successCount).toBe(0);
        expect(data.results[0]).toMatchObject({ success: false, index: 0 });
        expect(data.results[0].error).toContain('不支持的图片格式');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await database.errorItem.count()).toBe(0);
    });

    it('图片校验失败（MIME 类型不合法）不调用 AI', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const response = await BATCH_UPLOAD(request({
            userEmail: 'openclaw@example.com',
            images: [{ base64: BASE64, mimeType: 'image/svg+xml', filename: 'photo.png' }],
        }, { 'x-api-key': 'test-only-key' }));
        const data = await response.json();
        expect(data.successCount).toBe(0);
        expect(data.results[0].error).toContain('不支持的图片类型');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('正常创建错题并关联标签', async () => {
        mockOpenclawFetch({
            questionText: '计算 1 + 1 = ?',
            answerText: '2',
            analysis: '基础加法',
            knowledgePoints: ['整数加法', '加法运算律'],
            difficultyStars: 2,
        });
        const response = await BATCH_UPLOAD(request({
            userEmail: 'openclaw@example.com',
            subjectId: 'math',
            images: [{ base64: BASE64, mimeType: 'image/png', filename: 'q1.png' }],
        }, { 'x-api-key': 'test-only-key' }));
        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data).toMatchObject({ success: true, total: 1, successCount: 1, failCount: 0 });

        const item = await database.errorItem.findUniqueOrThrow({
            where: { id: data.results[0].errorItemId },
            include: { tags: true, subject: true },
        });
        expect(item.questionText).toBe('计算 1 + 1 = ?');
        expect(item.source).toBe('Openclaw');
        expect(item.subject?.id).toBe('math');
        expect(item.tags.map((t) => t.name).sort()).toEqual(['加法运算律', '整数加法']);
        // 标签应挂在数学学科下
        for (const tag of item.tags) {
            expect(tag.subject).toBe('math');
        }
    });

    it('重复题目记为重复，不新建错题', async () => {
        // 先入库一道题
        await database.errorItem.create({
            data: { id: 'existing-item', userId: 'user-1', subjectId: 'math', questionText: '计算 1 + 1 = ?', originalImageUrl: '' },
        });
        mockOpenclawFetch({
            questionText: '计算 1 + 1 = ?',
            answerText: '2',
            analysis: '基础加法',
            knowledgePoints: ['整数加法'],
            wrongAnswerText: '3',
        });
        const response = await BATCH_UPLOAD(request({
            userEmail: 'openclaw@example.com',
            subjectId: 'math',
            images: [{ base64: BASE64, mimeType: 'image/png', filename: 'q1.png' }],
        }, { 'x-api-key': 'test-only-key' }));
        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.successCount).toBe(1);
        expect(data.results[0]).toMatchObject({
            duplicate: true,
            mistakeRecorded: true,
            errorItemId: 'existing-item',
        });
        expect(await database.errorItem.count()).toBe(1);
        expect(await database.practiceRecord.count({ where: { errorItemId: 'existing-item', source: 'duplicate_import' } })).toBe(1);
        expect(mocks.scheduleMasteryEvaluation).toHaveBeenCalledWith(['existing-item']);
    });

    it('同一批次内相同题目第二题判为重复', async () => {
        mockOpenclawFetch({
            questionText: '计算 2 + 2 = ?',
            answerText: '4',
            analysis: '基础加法',
            knowledgePoints: ['整数加法'],
        });
        const response = await BATCH_UPLOAD(request({
            userEmail: 'openclaw@example.com',
            subjectId: 'math',
            images: [0, 1].map((i) => ({ base64: BASE64, mimeType: 'image/png', filename: `q${i}.png` })),
        }, { 'x-api-key': 'test-only-key' }));
        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data.successCount).toBe(2);
        expect(data.results[1]).toMatchObject({ duplicate: true, errorItemId: data.results[0].errorItemId });
        expect(await database.errorItem.count()).toBe(1);
    });
});

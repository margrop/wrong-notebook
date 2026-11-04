// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    session: { user: { id: 'user-1', email: 'export-test@example.com', role: 'user' }, expires: '2099-01-01' },
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/config', () => ({ getAppTimeZone: () => 'Asia/Shanghai' }));

import { POST } from '@/app/api/error-items/export-questions/route';
import { parseQuestionFile } from '@/lib/question-format';

let database: PrismaClient;
let directory: string;

const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function exportQuestions(body: unknown) {
    return POST(new Request('http://localhost/api/error-items/export-questions', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    }));
}

beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-export-questions-'));
    process.env.CONFIG_DIR = join(directory, 'config');
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    await database.errorItem.deleteMany();
    await database.knowledgeTag.deleteMany();
    await database.subject.deleteMany();
    await database.user.deleteMany();
    await database.user.create({ data: { id: 'user-1', email: mocks.session.user.email, password: 'test-only' } });
    await database.user.create({ data: { id: 'other-user', email: 'other@example.com', password: 'test-only' } });
    await database.subject.create({ data: { id: 'math', name: '数学', stage: 'junior_high', subjectKey: 'math', userId: 'user-1' } });
    await database.knowledgeTag.create({ data: { id: 'tag-1', name: '方程', subject: 'math', userId: 'user-1' } });
    await database.errorItem.create({
        data: {
            id: 'item-1', userId: 'user-1', subjectId: 'math', originalImageUrl: TINY_PNG_DATA_URL,
            questionText: '题目一', answerText: '答案一', analysis: '解析一', wrongAnswerText: '错答一',
            difficultyStars: 3, gradeSemester: '初一上', source: '期中', figureSvg: '<svg/>',
            tags: { connect: [{ id: 'tag-1' }] },
        },
    });
    await database.errorItem.create({
        data: {
            id: 'item-2', userId: 'user-1', subjectId: 'math', originalImageUrl: '',
            questionText: '题目二', answerText: '答案二', analysis: '解析二', wrongAnswerText: '错答二',
            difficultyStars: 4, gradeSemester: '初一下', source: '期末',
        },
    });
    await database.errorItem.create({
        data: {
            id: 'item-3', userId: 'other-user', originalImageUrl: '',
            questionText: '他人题目', answerText: '他人答案',
        },
    });
});

afterAll(async () => {
    delete process.env.CONFIG_DIR;
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('POST /api/error-items/export-questions', () => {
    it('未登录返回 401', async () => {
        vi.mocked((await import('next-auth')).getServerSession).mockResolvedValueOnce(null);
        const response = await exportQuestions({ ids: ['item-1'] });
        expect(response.status).toBe(401);
    });

    it('ids 为空数组返回 400', async () => {
        const response = await exportQuestions({ ids: [] });
        expect(response.status).toBe(400);
    });

    it('ids 超过 2000 返回 400', async () => {
        const ids = Array.from({ length: 2001 }, (_, i) => `id-${i}`);
        const response = await exportQuestions({ ids });
        expect(response.status).toBe(400);
    });

    it('ids 不是数组返回 400', async () => {
        const response = await exportQuestions({ ids: 'not-array' });
        expect(response.status).toBe(400);
    });

    it('只导出当前用户的错题，不泄露他人题目', async () => {
        const response = await exportQuestions({ ids: ['item-1', 'item-3'] });
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.questions).toHaveLength(1);
        expect(data.questions[0].text).toBe('题目一');
    });

    it('按 ids 顺序输出', async () => {
        const response = await exportQuestions({ ids: ['item-2', 'item-1'] });
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.questions.map((q: { text: string }) => q.text)).toEqual(['题目二', '题目一']);
    });

    it('空题干的题被跳过，跳过数通过响应头返回，文件内容保持交换格式', async () => {
        await database.errorItem.create({
            data: { id: 'item-empty', userId: 'user-1', originalImageUrl: '', questionText: '' },
        });
        const response = await exportQuestions({ ids: ['item-1', 'item-empty', 'item-2'] });
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.questions).toHaveLength(2);
        expect(data.questions.map((q: { text: string }) => q.text)).toEqual(['题目一', '题目二']);
        expect(response.headers.get('X-Export-Skipped')).toBe('1');
        expect(data.warnings).toBeUndefined();
    });

    it('includeImages=false 时不含图片', async () => {
        const response = await exportQuestions({ ids: ['item-1'] });
        const data = await response.json();
        expect(data.questions[0].images).toBeUndefined();
    });

    it('includeImages=true 且原图是 data URL 时含图片', async () => {
        const response = await exportQuestions({ ids: ['item-1'], includeImages: true });
        const data = await response.json();
        expect(data.questions[0].images).toEqual([{ dataUrl: TINY_PNG_DATA_URL }]);
    });

    it('includeImages=true 但原图不是 data URL 时不含图片', async () => {
        const response = await exportQuestions({ ids: ['item-2'], includeImages: true });
        const data = await response.json();
        expect(data.questions[0].images).toBeUndefined();
    });

    it('返回 Content-Type 和 Content-Disposition 头', async () => {
        const response = await exportQuestions({ ids: ['item-1'] });
        expect(response.headers.get('Content-Type')).toContain('application/json');
        const disposition = response.headers.get('Content-Disposition');
        expect(disposition).toContain('attachment');
        expect(disposition).toMatch(/filename="wrong-notebook-questions-\d{8}\.json"/);
    });

    it('导出结果能被 parseQuestionFile 无错误解析（往返）', async () => {
        const response = await exportQuestions({ ids: ['item-1', 'item-2'], includeImages: true });
        const rawText = await response.text();
        const parsed = parseQuestionFile(JSON.parse(rawText));
        expect(parsed.errors).toEqual([]);
        expect(parsed.questions).toHaveLength(2);
        expect(parsed.questions[0].text).toBe('题目一');
        expect(parsed.questions[1].text).toBe('题目二');
    });

    it('所有 id 都不属于当前用户时返回空 questions 数组', async () => {
        const response = await exportQuestions({ ids: ['item-3'] });
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.questions).toEqual([]);
    });
});

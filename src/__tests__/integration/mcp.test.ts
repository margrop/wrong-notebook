// @vitest-environment node
/**
 * MCP Streamable HTTP 端点（真实 SQLite）：
 * API Key 鉴权、初始化与工具清单、工具调用读写错题、无状态 JSON 响应与 GET 405。
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
    generateSimilarQuestion: vi.fn(),
    gradeAnswer: vi.fn(),
    consumeAiQuota: vi.fn(),
    selectBankQuestion: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/ai', () => ({
    getAIService: () => ({
        generateSimilarQuestion: mocks.generateSimilarQuestion,
        gradeAnswer: mocks.gradeAnswer,
    }),
}));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: mocks.consumeAiQuota }));
vi.mock('@/lib/question-bank/selection', () => ({ selectBankQuestion: mocks.selectBankQuestion }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/mastery', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mastery')>()),
    scheduleMasteryEvaluation: mocks.scheduleMasteryEvaluation,
}));

import { POST as MCP_POST, GET as MCP_GET } from '@/app/api/mcp/route';
import { createErrorResponse } from '@/lib/api-errors';
import { resetBackgroundTasksForTest } from '@/lib/background-tasks';

let database: PrismaClient;
let directory: string;

const API_KEY = 'test-mcp-key';
const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** 完整的 AI 题目结果（ParsedQuestion），供 generate_variant 的 AI mock 使用 */
function aiQuestion(overrides: Record<string, unknown> = {}) {
    return {
        questionText: '求解 3x = 9',
        answerText: 'x = 3',
        analysis: '两边除以 3 得 x = 3',
        wrongAnswerText: '',
        mistakeAnalysis: '',
        mistakeStatus: 'unknown',
        subject: '数学',
        knowledgePoints: ['一元一次方程'],
        requiresImage: false,
        difficultyStars: 2,
        questionType: 'calculation',
        gradeSemester: '七年级上',
        hasFigure: false,
        figureSvg: null,
        ...overrides,
    };
}

function mcpRequest(body: object, headers: Record<string, string> = {}) {
    return new Request('http://localhost/api/mcp', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'Authorization': `Bearer ${API_KEY}`,
            ...headers,
        },
    });
}

async function callTool(name: string, args: object = {}) {
    const response = await MCP_POST(mcpRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name, arguments: args },
    }));
    expect(response.status).toBe(200);
    return response.json() as Promise<{
        result?: { content: { type: string; text: string }[]; isError?: boolean };
        error?: { code: number; message: string };
    }>;
}

/** 从工具文本内容解析 JSON */
function toolJson(result: { content: { type: string; text: string }[] }) {
    return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

/** 通过 add_question 创建一道错题，返回其 id */
async function addErrorItem(questionText = '解方程 x+1=2') {
    const response = await callTool('add_question', {
        notebookId: 'math',
        questionText,
        answerText: 'x=1',
        analysis: '移项后得到 x=1',
        knowledgePoints: ['一元一次方程'],
        gradeSemester: '七年级上',
        difficultyStars: 2,
    });
    const data = toolJson(response.result!) as { question: { id: string } };
    return data.question.id;
}

beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-mcp-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    mocks.scheduleMasteryEvaluation.mockReset();
    mocks.generateSimilarQuestion.mockReset();
    mocks.gradeAnswer.mockReset();
    mocks.consumeAiQuota.mockReset();
    mocks.selectBankQuestion.mockReset();
    mocks.consumeAiQuota.mockResolvedValue(null);
    resetBackgroundTasksForTest();
    vi.stubEnv('MCP_API_KEY', API_KEY);
    vi.stubEnv('MCP_USER_EMAIL', 'mcp@example.com');
    await database.user.deleteMany();
    await database.user.create({
        data: { id: 'user-1', email: 'mcp@example.com', password: 'test-only', masteryThreshold: 50 },
    });
    await database.subject.create({
        data: {
            id: 'math', name: '数学', userId: 'user-1', subjectKey: 'math', tagSet: 'default', stage: 'junior_high',
        },
    });
});

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('MCP 服务', () => {
    it('密钥错误返回 401', async () => {
        const response = await MCP_POST(mcpRequest(
            { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
            { 'Authorization': 'Bearer wrong-key' },
        ));
        expect(response.status).toBe(401);
        const body = await response.json() as { error: { message: string } };
        expect(body.error.message).toContain('invalid MCP API key');
    });

    it('未配置密钥时返回 503', async () => {
        vi.stubEnv('MCP_API_KEY', '');
        const response = await MCP_POST(mcpRequest(
            { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
        ));
        expect(response.status).toBe(503);
    });

    it('初始化返回服务信息，工具清单包含全部工具', async () => {
        const init = await MCP_POST(mcpRequest({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
        }, { 'Accept': 'application/json' }));
        expect(init.status).toBe(200);
        const initBody = await init.json() as { result: { protocolVersion: string; serverInfo: { name: string } } };
        expect(initBody.result.serverInfo.name).toBe('wrong-notebook');
        expect(initBody.result.protocolVersion).toBeTruthy();

        const list = await MCP_POST(mcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
        const listBody = await list.json() as { result: { tools: { name: string }[] } };
        const names = listBody.result.tools.map((tool) => tool.name);
        expect(names).toEqual(expect.arrayContaining([
            'list_notebooks',
            'create_notebook',
            'list_questions',
            'get_question',
            'add_question',
            'list_tags',
            'list_due_reviews',
            'get_weak_tags',
            'record_practice_result',
            'generate_variant',
            'get_variant',
            'grade_answer',
        ]));
    });

    it('list_notebooks 返回当前账号的错题本', async () => {
        const response = await callTool('list_notebooks');
        const data = toolJson(response.result!) as { notebooks: { id: string; questionCount: number }[] };
        expect(data.notebooks).toEqual([
            expect.objectContaining({ id: 'math', questionCount: 0 }),
        ]);
    });

    it('add_question 写入错题与标签，重复题记录为 duplicate', async () => {
        const first = await callTool('add_question', {
            notebookId: 'math',
            questionText: '解方程 x+1=2',
            answerText: 'x=1',
            analysis: '移项后得到 x=1',
            knowledgePoints: ['一元一次方程'],
            gradeSemester: '七年级上',
            difficultyStars: 2,
        });
        const firstData = toolJson(first.result!) as {
            status: string;
            question: { id: string; shortId: string; tags: { name: string }[] };
        };
        expect(firstData.status).toBe('created');
        expect(firstData.question.tags).toEqual([expect.objectContaining({ name: '一元一次方程' })]);

        const stored = await database.errorItem.findUnique({ where: { id: firstData.question.id } });
        expect(stored?.questionText).toBe('解方程 x+1=2');
        expect(stored?.gradeSemester).toBe('七年级上');

        const second = await callTool('add_question', {
            notebookId: 'math',
            questionText: '解方程 x+1=2',
            answerText: 'x=1',
            analysis: '移项后得到 x=1',
            knowledgePoints: ['一元一次方程'],
            gradeSemester: '七年级上',
        });
        const secondData = toolJson(second.result!) as { status: string; question: { duplicate: boolean; id: string } };
        expect(secondData.status).toBe('duplicate');
        expect(secondData.question.id).toBe(firstData.question.id);
        expect(secondData.question.duplicate).toBe(true);
    });

    it('add_question 接受 figureImage 与 figureSource，内嵌位图 SVG 保留', async () => {
        const embeddedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="${PNG_DATA_URI}" width="10" height="10"/></svg>`;
        const response = await callTool('add_question', {
            notebookId: 'math',
            questionText: '如图，求面积',
            originalImageUrl: PNG_DATA_URI,
            figureSvg: embeddedSvg,
            figureImage: PNG_DATA_URI,
            figureSource: 'image',
            gradeSemester: '七年级上',
        });
        const data = toolJson(response.result!) as { status: string; question: { id: string } };
        expect(data.status).toBe('created');

        const stored = await database.errorItem.findUnique({ where: { id: data.question.id } });
        expect(stored?.figureSvg).toBe(embeddedSvg);
        expect(stored?.figureImage).toBe(PNG_DATA_URI);
        expect(stored?.figureSource).toBe('image');
    });

    it('list_questions 与 get_question 读取已保存的错题', async () => {
        await callTool('add_question', {
            notebookId: 'math',
            questionText: '计算 2+2',
            answerText: '4',
            gradeSemester: '七年级上',
        });

        const list = await callTool('list_questions', { notebookId: 'math', query: '2+2' });
        const listData = toolJson(list.result!) as { total: number; items: { id: string; shortId: string; questionText: string }[] };
        expect(listData.total).toBe(1);
        expect(listData.items[0].questionText).toBe('计算 2+2');

        const detail = await callTool('get_question', { id: listData.items[0].shortId });
        const detailData = toolJson(detail.result!) as { question: { answerText: string; subject: { name: string } } };
        expect(detailData.question.answerText).toBe('4');
        expect(detailData.question.subject.name).toBe('数学');
    });

    it('list_tags 返回叶子知识点标签', async () => {
        await database.knowledgeTag.create({
            data: { name: '一元一次方程', subject: 'math', isSystem: false, userId: 'user-1', tagSet: 'default' },
        });
        const response = await callTool('list_tags', { subject: 'math' });
        const data = toolJson(response.result!) as { tags: { name: string }[] };
        expect(data.tags.map((tag) => tag.name)).toContain('一元一次方程');
    });

    it('get_question 找不到时返回工具错误', async () => {
        const response = await callTool('get_question', { id: 'missing-question' });
        expect(response.result?.isError).toBe(true);
        expect(response.result?.content[0].text).toContain('not found');
    });

    it('generate_variant → get_variant → grade_answer → record_practice_result 端到端', async () => {
        const itemId = await addErrorItem();
        mocks.generateSimilarQuestion.mockResolvedValue(aiQuestion());
        mocks.gradeAnswer.mockResolvedValue({ correct: true, reason: 'x=3 正确' });

        const generated = await callTool('generate_variant', { errorItemId: itemId, difficulty: 'easy' });
        expect(generated.result?.isError).toBeFalsy();
        const generatedData = toolJson(generated.result!) as {
            questionText: string;
            subject: string;
            difficulty: string;
            source: string;
            generatedAt: string;
            practiceQuestionId: string;
            saved: boolean;
        };
        expect(generatedData.questionText).toBe('求解 3x = 9');
        expect(generatedData.subject).toBe('数学');
        expect(generatedData.difficulty).toBe('easy');
        expect(generatedData.source).toBe('ai');
        expect(generatedData.saved).toBe(true);
        expect(generatedData.practiceQuestionId).toBeTruthy();
        expect(mocks.consumeAiQuota).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'practice');
        expect(mocks.generateSimilarQuestion).toHaveBeenCalledWith(
            '解方程 x+1=2', ['一元一次方程'], undefined, 'easy', '七年级上', null,
        );

        const variant = await callTool('get_variant', { errorItemId: itemId });
        const variantData = toolJson(variant.result!) as { practice: Record<string, unknown> | null };
        expect(variantData.practice).toEqual(expect.objectContaining({
            questionText: '求解 3x = 9',
            answerText: 'x = 3',
            subject: '数学',
            difficulty: 'easy',
            source: 'ai',
        }));
        expect(variantData.practice?.generatedAt).toBe(generatedData.generatedAt);

        const graded = await callTool('grade_answer', {
            practiceQuestionId: generatedData.practiceQuestionId,
            userAnswer: 'x=3',
            language: 'zh',
        });
        expect(graded.result?.isError).toBeFalsy();
        expect(toolJson(graded.result!)).toEqual({ correct: true, reason: 'x=3 正确' });
        expect(mocks.consumeAiQuota).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'grade');
        expect(mocks.gradeAnswer).toHaveBeenCalledWith({
            questionText: '求解 3x = 9',
            answerText: 'x = 3',
            analysis: '两边除以 3 得 x = 3',
            userAnswer: 'x=3',
            language: 'zh',
        });

        const recorded = await callTool('record_practice_result', {
            practiceQuestionId: generatedData.practiceQuestionId,
            result: 'correct',
            source: 'practice',
        });
        expect(recorded.result?.isError).toBeFalsy();
        const recordData = toolJson(recorded.result!) as {
            id: string;
            errorItemId: string;
            practiceQuestionId: string;
            result: string;
            source: string;
            isCorrect: boolean;
            questionText: string;
            difficulty: string;
        };
        expect(recordData).toEqual(expect.objectContaining({
            errorItemId: itemId,
            practiceQuestionId: generatedData.practiceQuestionId,
            result: 'correct',
            source: 'practice',
            isCorrect: true,
            questionText: '求解 3x = 9',
            difficulty: 'easy',
        }));
        const stored = await database.practiceRecord.findUnique({ where: { id: recordData.id } });
        expect(stored?.result).toBe('correct');
        expect(stored?.source).toBe('practice');
        expect(stored?.practiceQuestionId).toBe(generatedData.practiceQuestionId);
        expect(mocks.scheduleMasteryEvaluation).toHaveBeenCalledWith([itemId]);
    });

    it('record_practice_result 顺序复习做对直接标记为已掌握', async () => {
        const itemId = await addErrorItem('解方程 2x=4');
        const response = await callTool('record_practice_result', {
            errorItemId: itemId,
            result: 'correct',
            source: 'review',
        });
        expect(response.result?.isError).toBeFalsy();
        expect(toolJson(response.result!)).toEqual(expect.objectContaining({
            result: 'correct',
            source: 'review',
            isCorrect: true,
        }));

        const item = await database.errorItem.findUnique({ where: { id: itemId } });
        expect(item?.masteryProbability).toBe(1);
        expect(item?.masteryLevel).toBe(2);
        expect(item?.masterySource).toBe('rule');
        expect(mocks.scheduleMasteryEvaluation).not.toHaveBeenCalled();
    });

    it('get_variant 无生成结果时返回 practice: null', async () => {
        const itemId = await addErrorItem();
        const response = await callTool('get_variant', { errorItemId: itemId });
        expect(toolJson(response.result!)).toEqual({ practice: null });
    });

    it('generate_variant / get_variant / grade_answer / record_practice_result 接受 6 位短 ID', async () => {
        const itemId = await addErrorItem('解方程 2x=4');
        const stored = await database.errorItem.findUnique({ where: { id: itemId }, select: { shortId: true } });
        expect(stored?.shortId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{6}$/);
        const shortId = stored!.shortId!;
        mocks.generateSimilarQuestion.mockResolvedValue(aiQuestion());
        mocks.gradeAnswer.mockResolvedValue({ correct: true, reason: 'x=2 正确' });

        const generated = await callTool('generate_variant', { errorItemId: shortId, difficulty: 'easy' });
        expect(generated.result?.isError).toBeFalsy();
        const generatedData = toolJson(generated.result!) as {
            questionText: string;
            practiceQuestionId: string;
            saved: boolean;
        };
        expect(generatedData.saved).toBe(true);
        const practiceQuestion = await database.practiceQuestion.findUnique({
            where: { id: generatedData.practiceQuestionId },
            select: { errorItemId: true },
        });
        expect(practiceQuestion?.errorItemId).toBe(itemId);

        const variant = await callTool('get_variant', { errorItemId: shortId });
        expect(toolJson(variant.result!)).toEqual(expect.objectContaining({
            practice: expect.objectContaining({ questionText: generatedData.questionText }),
        }));

        const graded = await callTool('grade_answer', { errorItemId: shortId, userAnswer: 'x=2' });
        expect(graded.result?.isError).toBeFalsy();
        expect(toolJson(graded.result!)).toEqual({ correct: true, reason: 'x=2 正确' });

        const recorded = await callTool('record_practice_result', { errorItemId: shortId, result: 'correct', source: 'review' });
        expect(recorded.result?.isError).toBeFalsy();
        const recordData = toolJson(recorded.result!) as { errorItemId: string; isCorrect: boolean };
        expect(recordData.errorItemId).toBe(itemId);
        expect(recordData.isCorrect).toBe(true);
        const item = await database.errorItem.findUnique({ where: { id: itemId } });
        expect(item?.masteryLevel).toBe(2);
    });

    it('generate_variant source=bank 从真题库选题，不消耗额度并写入历史题', async () => {
        const itemId = await addErrorItem();
        mocks.selectBankQuestion.mockResolvedValue({
            question: aiQuestion({
                questionText: '4 的后面一个数是几？',
                answerText: '5',
                analysis: '从 2 往后数。',
            }),
            bankId: 'bank-1',
            bankName: '小学数学题库',
            bankQuestionId: 'q1',
        });

        const response = await callTool('generate_variant', {
            errorItemId: itemId,
            source: 'bank',
            difficulty: 'medium',
        });
        expect(response.result?.isError).toBeFalsy();
        const data = toolJson(response.result!) as { source: string; saved: boolean; practiceQuestionId: string };
        expect(data.source).toBe('bank');
        expect(data.saved).toBe(true);
        expect(data.practiceQuestionId).toBeTruthy();
        expect(mocks.consumeAiQuota).not.toHaveBeenCalled();
        expect(mocks.generateSimilarQuestion).not.toHaveBeenCalled();
        expect(mocks.selectBankQuestion).toHaveBeenCalledWith(expect.objectContaining({
            tagNames: ['一元一次方程'],
            difficulty: 'medium',
            bankId: null,
        }));

        const stored = await database.practiceQuestion.findUnique({ where: { id: data.practiceQuestionId } });
        expect(stored?.source).toBe('bank');
        expect(stored?.questionText).toBe('4 的后面一个数是几？');
        const item = await database.errorItem.findUnique({ where: { id: itemId } });
        expect(JSON.parse(item?.lastPractice ?? '{}')).toEqual(expect.objectContaining({ source: 'bank' }));
    });

    it('generate_variant 额度拒绝返回含 code 的工具错误', async () => {
        const itemId = await addErrorItem();
        mocks.consumeAiQuota.mockResolvedValue(createErrorResponse('AI quota exhausted', 429, 'AI_QUOTA_INSUFFICIENT'));

        const response = await callTool('generate_variant', { errorItemId: itemId });
        expect(response.result?.isError).toBe(true);
        expect(response.result?.content[0].text).toContain('AI_QUOTA_INSUFFICIENT');
        expect(mocks.generateSimilarQuestion).not.toHaveBeenCalled();
        expect(mocks.consumeAiQuota).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'practice');
    });

    it('grade_answer 额度拒绝返回含 code 的工具错误', async () => {
        const itemId = await addErrorItem();
        mocks.generateSimilarQuestion.mockResolvedValue(aiQuestion());
        const generated = await callTool('generate_variant', { errorItemId: itemId });
        const generatedData = toolJson(generated.result!) as { practiceQuestionId: string };
        mocks.consumeAiQuota.mockResolvedValue(createErrorResponse('AI quota exhausted', 429, 'AI_QUOTA_INSUFFICIENT'));

        const response = await callTool('grade_answer', {
            practiceQuestionId: generatedData.practiceQuestionId,
            userAnswer: 'x=3',
        });
        expect(response.result?.isError).toBe(true);
        expect(response.result?.content[0].text).toContain('AI_QUOTA_INSUFFICIENT');
        expect(mocks.gradeAnswer).not.toHaveBeenCalled();
    });

    it('generate_variant 找不到错题或他人错题时返回工具错误', async () => {
        const missing = await callTool('generate_variant', { errorItemId: 'missing-item' });
        expect(missing.result?.isError).toBe(true);
        expect(missing.result?.content[0].text).toContain('not found');

        await database.user.create({
            data: { id: 'user-2', email: 'other@example.com', password: 'test-only' },
        });
        await database.errorItem.create({
            data: { id: 'other-item', userId: 'user-2', originalImageUrl: '', questionText: '他人错题' },
        });
        const other = await callTool('generate_variant', { errorItemId: 'other-item' });
        expect(other.result?.isError).toBe(true);
        expect(other.result?.content[0].text).toContain('not found');
        expect(mocks.consumeAiQuota).not.toHaveBeenCalled();
    });

    it('grade_answer 没有已存题目时返回工具错误', async () => {
        const itemId = await addErrorItem();
        const response = await callTool('grade_answer', { errorItemId: itemId, userAnswer: 'x=1' });
        expect(response.result?.isError).toBe(true);
        expect(response.result?.content[0].text).toContain('Practice question not found');
        expect(mocks.consumeAiQuota).not.toHaveBeenCalled();
    });

    it('未知工具返回 isError', async () => {
        const response = await callTool('unknown_tool');
        expect(response.result?.isError).toBe(true);
    });

    it('GET 无 SSE 流时返回 405', async () => {
        const response = await MCP_GET();
        expect(response.status).toBe(405);
        expect(response.headers.get('Allow')).toBe('POST');
    });
});

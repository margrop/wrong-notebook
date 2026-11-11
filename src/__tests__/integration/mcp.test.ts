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
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/ai', () => ({ getAIService: () => ({}) }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/mastery', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mastery')>()),
    scheduleMasteryEvaluation: mocks.scheduleMasteryEvaluation,
}));

import { POST as MCP_POST, GET as MCP_GET } from '@/app/api/mcp/route';

let database: PrismaClient;
let directory: string;

const API_KEY = 'test-mcp-key';

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

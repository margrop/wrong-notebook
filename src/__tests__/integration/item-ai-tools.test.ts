/**
 * 详情页 AI 工具接口：POST /api/error-items/:id/fix-latex（修复 LaTeX）、
 * POST /api/error-items/:id/reanswer（重新生成完整解答）
 * 以及按目标防重复：同一题目同一时刻只允许一个同类型后台任务
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    errorItem: { findUnique: vi.fn(), update: vi.fn() },
    fixLatex: vi.fn(),
    reanswerQuestion: vi.fn(),
    consumeAiQuota: vi.fn(),
    session: { user: { email: 'user@example.com' }, expires: '2099-01-01' } as { user: { email: string }; expires: string } | null,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user, errorItem: mocks.errorItem } }));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn(() => ({ fixLatex: mocks.fixLatex, reanswerQuestion: mocks.reanswerQuestion })) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: mocks.consumeAiQuota }));

import { POST as FIX } from '@/app/api/error-items/[id]/fix-latex/route';
import { POST as REANSWER } from '@/app/api/error-items/[id]/reanswer/route';
import { resetBackgroundTasksForTest } from '@/lib/background-tasks';

const context = { params: Promise.resolve({ id: 'e1' }) };
const fix = () => FIX(new Request('http://localhost', { method: 'POST' }), context);
const reanswer = (body: unknown = {}) => REANSWER(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }), context);

const cleanItem = { userId: 'user-1', questionText: '求 $\\frac{1}{2}$', answerText: '$1$', analysis: '直接计算', wrongAnswerText: null, mistakeAnalysis: null };

beforeEach(() => {
    vi.clearAllMocks();
    resetBackgroundTasksForTest();
    mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
    mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
    mocks.errorItem.update.mockImplementation(async ({ data }) => data);
    mocks.consumeAiQuota.mockResolvedValue(null);
});

describe('POST /api/error-items/:id/fix-latex', () => {
    it('没有 LaTeX 问题时不调用 AI', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(cleanItem);

        const response = await fix();

        expect(await response.json()).toEqual({ issuesBefore: 0, issuesAfter: 0, fixedFields: [], updated: {} });
        expect(mocks.fixLatex).not.toHaveBeenCalled();
    });

    it('只把有问题的字段交给 AI，保存问题减少的修复结果，丢弃没有改善的结果', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...cleanItem, answerText: '$\\frac{1}{2$', analysis: '因为 \\times 2' });
        mocks.fixLatex.mockResolvedValue({ answerText: '$\\frac{1}{2}$', analysis: '因为 \\times 2' });

        const response = await fix();
        const body = await response.json();

        expect(Object.keys(mocks.fixLatex.mock.calls[0][0])).toEqual(['answerText', 'analysis']);
        expect(mocks.fixLatex.mock.calls[0][0].answerText.text).toBe('$\\frac{1}{2$');
        expect(mocks.errorItem.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { answerText: '$\\frac{1}{2}$' } });
        expect(body).toEqual({ issuesBefore: 2, issuesAfter: 1, fixedFields: ['answerText'], updated: { answerText: '$\\frac{1}{2}$' } });
    });

    it('AI 结果都不可用时不写数据库', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...cleanItem, answerText: '$\\frac{1}{2$' });
        mocks.fixLatex.mockResolvedValue({});

        const body = await (await fix()).json();

        expect(mocks.errorItem.update).not.toHaveBeenCalled();
        expect(body.fixedFields).toEqual([]);
        expect(body.issuesAfter).toBe(1);
    });

    it('AI 报错时返回错误码；未登录或他人的题目不能修复', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...cleanItem, answerText: '$\\frac{1}{2$' });
        mocks.fixLatex.mockRejectedValue(new Error('AI_TIMEOUT_ERROR'));
        expect((await (await fix()).json()).message).toBe('AI_TIMEOUT_ERROR');

        mocks.errorItem.findUnique.mockResolvedValue({ ...cleanItem, userId: 'other' });
        expect((await fix()).status).toBe(404);
        mocks.session = null;
        expect((await fix()).status).toBe(401);
    });
});

describe('POST /api/error-items/:id/reanswer', () => {
    const item = {
        userId: 'user-1',
        questionText: '求 1+1',
        originalImageUrl: 'data:image/png;base64,QUJD',
        gradeSemester: '三年级上',
        subject: { name: '我的数学', stage: 'primary', subjectKey: 'math' },
    };

    it('带原图、学科和年级重新解题，只覆盖答案和解析', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(item);
        mocks.reanswerQuestion.mockResolvedValue({ answerText: '$2$', analysis: '1 加 1 等于 2', knowledgePoints: ['加法'], wrongAnswerText: 'x', mistakeAnalysis: 'y', mistakeStatus: 'wrong_attempt' });

        const response = await reanswer({ language: 'zh' });

        expect(response.status).toBe(200);
        expect(mocks.reanswerQuestion).toHaveBeenCalledWith('求 1+1', 'zh', '数学', 'data:image/png;base64,QUJD', '三年级上');
        expect(mocks.errorItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { answerText: '$2$', analysis: '1 加 1 等于 2' } }));
        expect(await response.json()).toEqual({ answerText: '$2$', analysis: '1 加 1 等于 2' });
    });

    it('文字录入（无原图）时只用题目文字', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...item, originalImageUrl: '', subject: null });
        mocks.reanswerQuestion.mockResolvedValue({ answerText: '2', analysis: '计算' });

        await reanswer();

        expect(mocks.reanswerQuestion).toHaveBeenCalledWith('求 1+1', 'zh', null, undefined, '三年级上');
    });

    it('题目为空或 AI 没有返回解答时不覆盖', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...item, questionText: ' ' });
        expect((await (await reanswer()).json()).message).toBe('NO_QUESTION_TEXT');

        mocks.errorItem.findUnique.mockResolvedValue(item);
        mocks.reanswerQuestion.mockResolvedValue({ answerText: '', analysis: ' ' });
        expect((await (await reanswer()).json()).message).toBe('EMPTY_ANSWER');
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
    });

    it('未登录或他人的题目不能重新解题', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...item, userId: 'other' });
        expect((await reanswer()).status).toBe(404);
        mocks.session = null;
        expect((await reanswer()).status).toBe(401);
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
    });
});

describe('按目标防重复（fix-latex / reanswer）', () => {
    const item = {
        userId: 'user-1',
        questionText: '求 1+1',
        originalImageUrl: null,
        gradeSemester: null,
        subject: null,
    };
    const badLatexItem = { ...cleanItem, answerText: '$\\frac{1}{2$' };

    it('修复 LaTeX 并发两次：第二个 409，只扣一次额度、只调用一次 AI', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(badLatexItem);
        let finish!: (value: unknown) => void;
        mocks.fixLatex.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

        const first = fix();
        // 等待第一个请求完成预占与额度校验，进入 AI 调用
        await vi.waitFor(() => expect(mocks.fixLatex).toHaveBeenCalledTimes(1));

        const second = await fix();
        expect(second.status).toBe(409);
        expect((await second.json()).code).toBe('TASK_ALREADY_RUNNING');
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(1);
        expect(mocks.fixLatex).toHaveBeenCalledTimes(1);

        finish({ answerText: '$\\frac{1}{2}$' });
        expect((await first).status).toBe(200);
        // 任务结束后可再次发起
        mocks.fixLatex.mockResolvedValue({ answerText: '$\\frac{1}{2}$' });
        expect((await fix()).status).toBe(200);
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(2);
    });

    it('重新解答并发两次：第二个 409，只扣一次额度、只调用一次 AI', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(item);
        let finish!: (value: unknown) => void;
        mocks.reanswerQuestion.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

        const first = reanswer();
        await vi.waitFor(() => expect(mocks.reanswerQuestion).toHaveBeenCalledTimes(1));

        const second = await reanswer();
        expect(second.status).toBe(409);
        expect((await second.json()).code).toBe('TASK_ALREADY_RUNNING');
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(1);
        expect(mocks.reanswerQuestion).toHaveBeenCalledTimes(1);

        finish({ answerText: '2', analysis: '计算' });
        expect((await first).status).toBe(200);
    });

    it('修复 LaTeX 额度不足返回 429，预占已撤下、可再次发起', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(badLatexItem);
        mocks.consumeAiQuota.mockResolvedValueOnce(
            NextResponse.json({ code: 'AI_DAILY_LIMIT_EXCEEDED' }, { status: 429 }),
        );
        mocks.fixLatex.mockResolvedValue({ answerText: '$\\frac{1}{2}$' });

        expect((await fix()).status).toBe(429);
        expect(mocks.fixLatex).not.toHaveBeenCalled();

        // 预占已 cancel：再次发起不再 409，而是正常执行
        expect((await fix()).status).toBe(200);
        expect(mocks.fixLatex).toHaveBeenCalledTimes(1);
    });

    it('重新解答额度不足返回 429，预占已撤下、可再次发起', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(item);
        mocks.consumeAiQuota.mockResolvedValueOnce(
            NextResponse.json({ code: 'AI_DAILY_LIMIT_EXCEEDED' }, { status: 429 }),
        );
        mocks.reanswerQuestion.mockResolvedValue({ answerText: '2', analysis: '计算' });

        expect((await reanswer()).status).toBe(429);
        expect(mocks.reanswerQuestion).not.toHaveBeenCalled();

        expect((await reanswer()).status).toBe(200);
        expect(mocks.reanswerQuestion).toHaveBeenCalledTimes(1);
    });

    it('重新解答不同题目互不影响', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(item);
        let finish!: (value: unknown) => void;
        mocks.reanswerQuestion.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        mocks.reanswerQuestion.mockResolvedValueOnce({ answerText: 'b', analysis: 'B' });

        const first = reanswer();
        await vi.waitFor(() => expect(mocks.reanswerQuestion).toHaveBeenCalledTimes(1));

        const otherContext = { params: Promise.resolve({ id: 'e2' }) };
        const other = await REANSWER(new Request('http://localhost', { method: 'POST', body: '{}' }), otherContext);
        expect(other.status).toBe(200);
        finish({ answerText: 'a', analysis: 'A' });
        expect((await first).status).toBe(200);
    });
});

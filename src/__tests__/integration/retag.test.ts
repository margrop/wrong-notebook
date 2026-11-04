/**
 * 知识点重新生成 API 集成测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    errorItem: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    knowledgeTag: { findMany: vi.fn() },
    subject: { findUnique: vi.fn() },
    paperGroup: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    suggestKnowledgeTags: vi.fn(),
    getMathTagsFromDB: vi.fn(),
    getScopeTagsFromDB: vi.fn(),
    consumeAiQuota: vi.fn(),
    session: { user: { email: 'user@example.com' }, expires: '2099-01-01' },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: { user: mocks.user, errorItem: mocks.errorItem, knowledgeTag: mocks.knowledgeTag, subject: mocks.subject, paperGroup: mocks.paperGroup },
}));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn(() => ({ suggestKnowledgeTags: mocks.suggestKnowledgeTags })) }));
vi.mock('@/lib/ai/tag-service', () => ({ getMathTagsFromDB: mocks.getMathTagsFromDB, getScopeTagsFromDB: mocks.getScopeTagsFromDB }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: mocks.consumeAiQuota }));

import { POST as RETAG_ITEM } from '@/app/api/error-items/[id]/retag/route';
import { GET as JOB_STATUS, POST as START_JOB } from '@/app/api/notebooks/[id]/retag/route';
import { resetBackgroundTasksForTest } from '@/lib/background-tasks';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const item = {
    userId: 'user-1',
    questionText: '鸡兔同笼，共 10 个头 28 条腿',
    answerText: '鸡 6 兔 4',
    analysis: '假设法',
    wrongAnswerText: '鸡 4 兔 6',
    mistakeAnalysis: '数量算反',
    gradeSemester: '四年级上',
    questionType: null as string | null,
    subject: { name: '数学', stage: 'primary', subjectKey: 'math' },
    tags: [
        { id: 'old-sys', name: '100以内加法', isSystem: true },
        { id: 'custom-1', name: '易错', isSystem: false },
    ],
    user: { educationStage: 'primary', enrollmentYear: 2023 },
};

describe('知识点重新生成', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetBackgroundTasksForTest();
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mocks.consumeAiQuota.mockResolvedValue(null);
        mocks.getScopeTagsFromDB.mockResolvedValue(['鸡兔同笼', '假设法解鸡兔同笼', '植树问题']);
        mocks.getMathTagsFromDB.mockResolvedValue(['鸡兔同笼', '假设法解鸡兔同笼', '植树问题']);
        // 模拟默认分组：key='a' → group-a，key='b' → group-b
        mocks.paperGroup.findFirst.mockImplementation(async (args: { where?: { key?: string } }) => {
            const key = args?.where?.key;
            if (key === 'a') return { id: 'group-a' };
            if (key === 'b') return { id: 'group-b' };
            return null;
        });
    });

    it('preview 模式只返回建议的知识点（含保留的自定义标签），不写数据库', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(item);
        mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['鸡兔同笼'], difficultyStars: 3, questionType: 'solution' });
        mocks.knowledgeTag.findMany.mockResolvedValue([{ id: 'tag-b', name: '鸡兔同笼' }]);

        const response = await RETAG_ITEM(new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ preview: true }),
        }), params('e1'));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ tags: ['鸡兔同笼', '易错'], difficultyStars: 3, questionType: 'solution' });
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
    });

    it('preview 模式同样不能读取其他用户的题目', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...item, userId: 'other-user' });

        const response = await RETAG_ITEM(new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ preview: true }),
        }), params('e1'));

        expect(response.status).toBe(404);
        expect(mocks.suggestKnowledgeTags).not.toHaveBeenCalled();
    });

    it('替换系统标签、保留自定义标签，候选知识点取错题本学段 + 学科下的全部标签', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(item);
        mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['假设法解鸡兔同笼', '鸡兔同笼'], difficultyStars: 2, questionType: 'solution' });
        mocks.knowledgeTag.findMany.mockResolvedValue([
            { id: 'tag-a', name: '假设法解鸡兔同笼' },
            { id: 'tag-b', name: '鸡兔同笼' },
            { id: 'tag-b-dup', name: '鸡兔同笼' },
        ]);

        const response = await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.tags).toEqual(['假设法解鸡兔同笼', '鸡兔同笼', '易错']);
        expect(data.questionType).toBe('solution');
        expect(mocks.getScopeTagsFromDB).toHaveBeenCalledWith('math', 'primary', 'default');
        expect(mocks.getMathTagsFromDB).not.toHaveBeenCalled();
        expect(mocks.suggestKnowledgeTags.mock.calls[0][0]).toMatchObject({
            subject: '数学',
            gradeSemester: '四年级上',
            questionText: '鸡兔同笼，共 10 个头 28 条腿',
            answerText: '鸡 6 兔 4',
            analysis: '假设法',
            wrongAnswerText: '鸡 4 兔 6',
            mistakeAnalysis: '数量算反',
        });
        expect(mocks.errorItem.update).toHaveBeenCalledWith({
            where: { id: 'e1' },
            data: {
                knowledgePoints: JSON.stringify(['假设法解鸡兔同笼', '鸡兔同笼', '易错']),
                difficultyStars: 2,
                questionType: 'solution',
                paperLevel: 'group-a',
                tags: { disconnect: [{ id: 'old-sys' }], connect: [{ id: 'tag-a' }, { id: 'tag-b' }] },
            },
        });
    });

    it('题目已有题型时不覆盖：AI 判断的题型被忽略', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...item, questionType: 'fill_blank' });
        mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['鸡兔同笼'], difficultyStars: 2, questionType: 'solution' });
        mocks.knowledgeTag.findMany.mockResolvedValue([{ id: 'tag-b', name: '鸡兔同笼' }]);

        const response = await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));
        const data = await response.json();

        expect(response.status).toBe(200);
        // 返回的 questionType 为 null（不覆盖已有题型）
        expect(data.questionType).toBeNull();
        // 数据库更新不包含 questionType 字段
        expect(mocks.errorItem.update).toHaveBeenCalledWith({
            where: { id: 'e1' },
            data: {
                knowledgePoints: JSON.stringify(['鸡兔同笼', '易错']),
                difficultyStars: 2,
                paperLevel: 'group-a',
                tags: { disconnect: [{ id: 'old-sys' }], connect: [{ id: 'tag-b' }] },
            },
        });
        const updateData = mocks.errorItem.update.mock.calls[0][0].data;
        expect(updateData).not.toHaveProperty('questionType');
    });

    it('题目题型为空时写入 AI 判断的题型', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...item, questionType: null });
        mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['鸡兔同笼'], difficultyStars: 2, questionType: 'calculation' });
        mocks.knowledgeTag.findMany.mockResolvedValue([{ id: 'tag-b', name: '鸡兔同笼' }]);

        const response = await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.questionType).toBe('calculation');
        expect(mocks.errorItem.update.mock.calls[0][0].data.questionType).toBe('calculation');
    });

    it('高中物理错题本取高中物理的全部知识点', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...item, subject: { name: '物理错题', stage: 'senior_high', subjectKey: 'physics' } });
        mocks.getScopeTagsFromDB.mockResolvedValue(['牛顿第二定律']);
        mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['牛顿第二定律'], difficultyStars: 3, questionType: 'solution' });
        mocks.knowledgeTag.findMany.mockResolvedValue([{ id: 'tag-n', name: '牛顿第二定律' }]);

        const response = await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));

        expect(response.status).toBe(200);
        expect(mocks.getScopeTagsFromDB).toHaveBeenCalledWith('physics', 'senior_high', 'default');
        expect(mocks.suggestKnowledgeTags.mock.calls[0][0]).toMatchObject({ subject: '物理', allowedTags: ['牛顿第二定律'] });
    });

    it('不在错题本中的题目仍按学生年级取数学知识点', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...item, subject: null });
        mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['鸡兔同笼'], difficultyStars: 2, questionType: null });
        mocks.knowledgeTag.findMany.mockResolvedValue([{ id: 'tag-b', name: '鸡兔同笼' }]);

        await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));

        expect(mocks.getMathTagsFromDB).toHaveBeenCalledWith(expect.any(Number));
        expect(mocks.getScopeTagsFromDB).not.toHaveBeenCalled();
    });

    it('AI 未给出难度星级时保留原星级', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(item);
        mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['鸡兔同笼'], difficultyStars: null, questionType: null });
        mocks.knowledgeTag.findMany.mockResolvedValue([{ id: 'tag-b', name: '鸡兔同笼' }]);

        const response = await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));

        expect(response.status).toBe(200);
        expect(mocks.errorItem.update.mock.calls[0][0].data).not.toHaveProperty('difficultyStars');
        expect(mocks.errorItem.update.mock.calls[0][0].data).not.toHaveProperty('paperLevel');
    });

    it.each([null, 'group-a', 'group-other'])('补评为 5 星时只为未设置卷别的题目补默认值（原卷别 %s）', async (paperLevel) => {
        mocks.errorItem.findUnique.mockResolvedValue({ ...item, paperLevel });
        mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['鸡兔同笼'], difficultyStars: 5, questionType: null });
        mocks.knowledgeTag.findMany.mockResolvedValue([{ id: 'tag-b', name: '鸡兔同笼' }]);
        expect((await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'))).status).toBe(200);
        const data = mocks.errorItem.update.mock.calls[0][0].data;
        if (paperLevel === null) expect(data.paperLevel).toBe('group-b');
        else expect(data).not.toHaveProperty('paperLevel');
    });

    it('他人的题目返回 404，AI 未选出知识点时返回 400 且不修改', async () => {
        mocks.errorItem.findUnique.mockResolvedValueOnce({ ...item, userId: 'other' });
        const foreign = await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));
        expect(foreign.status).toBe(404);

        mocks.errorItem.findUnique.mockResolvedValueOnce(item);
        mocks.suggestKnowledgeTags.mockResolvedValueOnce({ tags: [], difficultyStars: null });
        const empty = await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));
        expect(empty.status).toBe(400);
        expect((await empty.json()).message).toBe('NO_TAGS_SELECTED');
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
    });

    it('AI 错误码透传给前端', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(item);
        mocks.suggestKnowledgeTags.mockRejectedValue(new Error('AI_AUTH_ERROR: invalid key'));

        const response = await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));

        expect(response.status).toBe(500);
        expect((await response.json()).message).toBe('AI_AUTH_ERROR');
    });

    it('按目标防重复：并发两次第二个 409，只扣一次额度、只调用一次 AI；任务结束后可再次发起', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(item);
        mocks.knowledgeTag.findMany.mockResolvedValue([{ id: 'tag-b', name: '鸡兔同笼' }]);
        let finish!: (value: unknown) => void;
        mocks.suggestKnowledgeTags
            .mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
            .mockResolvedValue({ tags: ['鸡兔同笼'], difficultyStars: 2, questionType: null });

        const first = RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));
        await vi.waitFor(() => expect(mocks.suggestKnowledgeTags).toHaveBeenCalledTimes(1));

        const second = await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'));
        expect(second.status).toBe(409);
        expect((await second.json()).code).toBe('TASK_ALREADY_RUNNING');
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(1);
        expect(mocks.suggestKnowledgeTags).toHaveBeenCalledTimes(1);

        finish({ tags: ['鸡兔同笼'], difficultyStars: 2, questionType: null });
        expect((await first).status).toBe(200);

        // 任务结束后可再次发起（预占已释放）
        expect((await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'))).status).toBe(200);
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(2);
    });

    it('按目标防重复：额度不足返回 429，预占已撤下、可再次发起', async () => {
        mocks.errorItem.findUnique.mockResolvedValue(item);
        mocks.knowledgeTag.findMany.mockResolvedValue([{ id: 'tag-b', name: '鸡兔同笼' }]);
        mocks.consumeAiQuota.mockResolvedValueOnce(
            NextResponse.json({ code: 'AI_DAILY_LIMIT_EXCEEDED' }, { status: 429 }),
        );
        mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['鸡兔同笼'], difficultyStars: 2, questionType: null });

        expect((await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'))).status).toBe(429);
        expect(mocks.suggestKnowledgeTags).not.toHaveBeenCalled();

        expect((await RETAG_ITEM(new Request('http://localhost', { method: 'POST' }), params('e1'))).status).toBe(200);
        expect(mocks.suggestKnowledgeTags).toHaveBeenCalledTimes(1);
    });

    it('批量任务在后台逐题处理并汇报进度', async () => {
        mocks.subject.findUnique.mockResolvedValue({ userId: 'user-1' });
        mocks.errorItem.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
        mocks.errorItem.findUnique
            .mockResolvedValueOnce(item)
            .mockResolvedValueOnce({ ...item, questionText: '' });
        mocks.suggestKnowledgeTags.mockResolvedValue({ tags: ['鸡兔同笼'], difficultyStars: 3, questionType: null });
        mocks.knowledgeTag.findMany.mockResolvedValue([{ id: 'tag-b', name: '鸡兔同笼' }]);

        const started = await START_JOB(new Request('http://localhost', { method: 'POST' }), params('nb-1'));
        expect(started.status).toBe(202);
        expect(await started.json()).toMatchObject({ total: 2, running: true });

        await vi.waitFor(async () => {
            const status = await (await JOB_STATUS(new Request('http://localhost'), params('nb-1'))).json();
            expect(status).toMatchObject({ total: 2, done: 2, failed: 1, running: false });
        });
        expect(mocks.errorItem.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1', subjectId: 'nb-1' });
    });

    it('不能对他人的错题本发起任务', async () => {
        mocks.subject.findUnique.mockResolvedValue({ userId: 'other' });

        const response = await START_JOB(new Request('http://localhost', { method: 'POST' }), params('nb-x'));

        expect(response.status).toBe(404);
        expect(mocks.errorItem.findMany).not.toHaveBeenCalled();
    });
});

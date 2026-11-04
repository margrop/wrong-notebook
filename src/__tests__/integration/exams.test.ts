/**
 * /api/exams 错题试卷 API 集成测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
    const tx = {
        practiceRecord: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        examQuestion: { update: vi.fn() },
        examPaper: { update: vi.fn() },
    };
    return {
        tx,
        user: { findUnique: vi.fn() },
        subject: { findMany: vi.fn() },
        errorItem: { findMany: vi.fn() },
        examPaper: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
        examQuestion: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
        practiceRecord: { updateMany: vi.fn() },
        transaction: vi.fn(async (arg: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[]) => (
            Array.isArray(arg) ? Promise.all(arg) : arg(tx)
        )),
        generateSimilarQuestion: vi.fn(),
        reanswerQuestion: vi.fn(),
        scheduleMasteryEvaluation: vi.fn(),
        session: { user: { email: 'user@example.com' }, expires: '2099-01-01' },
    };
});

vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: mocks.user,
        subject: mocks.subject,
        errorItem: mocks.errorItem,
        examPaper: mocks.examPaper,
        examQuestion: mocks.examQuestion,
        practiceRecord: mocks.practiceRecord,
        $transaction: mocks.transaction,
    },
}));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn(() => ({ generateSimilarQuestion: mocks.generateSimilarQuestion, reanswerQuestion: mocks.reanswerQuestion })) }));
vi.mock('@/lib/mastery', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mastery')>()),
    scheduleMasteryEvaluation: mocks.scheduleMasteryEvaluation,
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/config', () => ({ getAppTimeZone: vi.fn(() => 'Asia/Shanghai') }));

import { POST as CREATE, GET as LIST } from '@/app/api/exams/route';
import { GET as DETAIL, PATCH as UPDATE_SCALE, DELETE } from '@/app/api/exams/[id]/route';
import { POST as RESULTS } from '@/app/api/exams/[id]/results/route';
import { POST as REGENERATE } from '@/app/api/exams/[id]/questions/[questionId]/regenerate/route';
import { generateExamPaper } from '@/lib/exam/exam';
import { getAppTimeZone } from '@/lib/config';

const json = (url: string, method: string, body: object) => new Request(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('/api/exams', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        // 后台生成在测试中立即结束
        mocks.examPaper.findUnique.mockResolvedValue(null);
    });

    describe('POST 创建试卷', () => {
        const options = { subjectIds: ['s1'], scope: 'unmastered', count: 2, difficulty: 'hard' };

        it.each([['Asia/Shanghai', '11:27'], ['UTC', '03:27']])('默认标题按全局时区 %s 生成时间', async (timeZone, time) => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-19T03:27:00Z'));
            vi.mocked(getAppTimeZone).mockReturnValueOnce(timeZone);
            mocks.subject.findMany.mockResolvedValue([{ id: 's1', name: '数学' }]);
            mocks.errorItem.findMany.mockResolvedValue([{ id: 'e1', shortId: 'AAAAAA', questionText: '题1', _count: { practiceRecords: 0 } }]);
            mocks.examPaper.create.mockResolvedValue({ id: 'p1', title: '数学', requestedCount: 2, _count: { questions: 1 } });
            try {
                expect((await CREATE(json('http://localhost/api/exams', 'POST', options))).status).toBe(201);
                expect(mocks.examPaper.create.mock.calls[0][0].data.title).toBe(`数学 2026-10-19 ${time}`);
            } finally {
                vi.useRealTimers();
            }
        });

        const practicedItems = [
            { id: 'e1', shortId: 'AAAAAA', questionText: '题1', _count: { practiceRecords: 5 } },
            { id: 'e2', shortId: 'BBBBBB', questionText: '题2', _count: { practiceRecords: 0 } },
            { id: 'e3', shortId: 'CCCCCC', questionText: '题3', _count: { practiceRecords: 1 } },
        ];

        it('完全随机抽题并记录来源短 ID', async () => {
            mocks.subject.findMany.mockResolvedValue([{ id: 's1', name: '数学' }]);
            mocks.errorItem.findMany.mockResolvedValue(practicedItems);
            mocks.examPaper.create.mockResolvedValue({ id: 'p1', title: '数学', requestedCount: 2, _count: { questions: 2 } });

            const response = await CREATE(json('http://localhost/api/exams', 'POST', { ...options, pickRule: 'random' }));

            expect(response.status).toBe(201);
            const where = mocks.errorItem.findMany.mock.calls[0][0].where;
            expect(where).toMatchObject({ userId: 'user-1', subjectId: { in: ['s1'] }, NOT: { masteryProbability: { gte: 0.5 } } });
            const created = mocks.examPaper.create.mock.calls[0][0].data;
            expect(created.questions.create).toHaveLength(2);
            for (const question of created.questions.create) {
                expect(['AAAAAA', 'BBBBBB', 'CCCCCC']).toContain(question.sourceShortId);
            }
            expect(created).toMatchObject({ userId: 'user-1', scope: 'unmastered', difficulty: 'hard', requestedCount: 2 });
        });

        it('默认优先抽取练习次数少的题目', async () => {
            mocks.subject.findMany.mockResolvedValue([{ id: 's1', name: '数学' }]);
            mocks.errorItem.findMany.mockResolvedValue(practicedItems);
            mocks.examPaper.create.mockResolvedValue({ id: 'p1', title: '数学', requestedCount: 2, _count: { questions: 2 } });

            const response = await CREATE(json('http://localhost/api/exams', 'POST', options));

            expect(response.status).toBe(201);
            expect(mocks.errorItem.findMany.mock.calls[0][0].select._count).toEqual({ select: { practiceRecords: true, examQuestions: true } });
            const created = mocks.examPaper.create.mock.calls[0][0].data;
            expect(created.questions.create.map((question: { errorItemId: string }) => question.errorItemId)).toEqual(['e2', 'e3']);
        });

        it('优先练习较少时，同练习次数下优先抽取未出现在已有试卷中的题目', async () => {
            mocks.subject.findMany.mockResolvedValue([{ id: 's1', name: '数学' }]);
            mocks.errorItem.findMany.mockResolvedValue([
                { id: 'e1', shortId: 'AAAAAA', questionText: '题1', _count: { practiceRecords: 1, examQuestions: 2 } },
                { id: 'e2', shortId: 'BBBBBB', questionText: '题2', _count: { practiceRecords: 0, examQuestions: 1 } },
                { id: 'e3', shortId: 'CCCCCC', questionText: '题3', _count: { practiceRecords: 0, examQuestions: 0 } },
                { id: 'e4', shortId: 'DDDDDD', questionText: '题4', _count: { practiceRecords: 1, examQuestions: 0 } },
            ]);
            mocks.examPaper.create.mockResolvedValue({ id: 'p1', title: '数学', requestedCount: 3, _count: { questions: 3 } });

            const response = await CREATE(json('http://localhost/api/exams', 'POST', { ...options, count: 3 }));

            expect(response.status).toBe(201);
            const created = mocks.examPaper.create.mock.calls[0][0].data;
            expect(created.questions.create.map((question: { errorItemId: string }) => question.errorItemId)).toEqual(['e3', 'e2', 'e4']);
        });

        it('没有符合条件的错题时返回 NO_SOURCE_ITEMS', async () => {
            mocks.subject.findMany.mockResolvedValue([{ id: 's1', name: '数学' }]);
            mocks.errorItem.findMany.mockResolvedValue([]);

            const response = await CREATE(json('http://localhost/api/exams', 'POST', options));

            expect(response.status).toBe(400);
            expect((await response.json()).message).toBe('NO_SOURCE_ITEMS');
        });

        it('不能使用他人的错题本', async () => {
            mocks.subject.findMany.mockResolvedValue([]);

            const response = await CREATE(json('http://localhost/api/exams', 'POST', options));

            expect(response.status).toBe(400);
            expect(mocks.subject.findMany.mock.calls[0][0].where.userId).toBe('user-1');
        });

        it('校验题量、范围与抽题规则', async () => {
            const tooMany = await CREATE(json('http://localhost/api/exams', 'POST', { ...options, count: 51 }));
            const badScope = await CREATE(json('http://localhost/api/exams', 'POST', { ...options, scope: 'some' }));
            const badRule = await CREATE(json('http://localhost/api/exams', 'POST', { ...options, pickRule: 'hardest' }));

            expect(tooMany.status).toBe(400);
            expect(badScope.status).toBe(400);
            expect(badRule.status).toBe(400);
        });

        it('原题直出模式：不调用 AI 与额度，题目创建即 ready，difficulty 可省略', async () => {
            mocks.subject.findMany.mockResolvedValue([{ id: 's1', name: '数学' }]);
            mocks.errorItem.findMany
                .mockResolvedValueOnce([{ id: 'e1', shortId: 'AAAAAA', questionText: '原题', _count: { practiceRecords: 0 } }])
                .mockResolvedValueOnce([{
                    id: 'e1', shortId: 'AAAAAA',
                    questionText: '原题', answerText: '答', analysis: '析', figureSvg: '<svg/>',
                    figureScale: 65, figureAlign: 'left', answerSpacePx: 240,
                }]);
            mocks.examPaper.create.mockResolvedValue({ id: 'p1', title: '数学', requestedCount: 1, _count: { questions: 1 } });

            const response = await CREATE(json('http://localhost/api/exams', 'POST', {
                subjectIds: ['s1'], scope: 'all', count: 1, mode: 'original',
            }));

            expect(response.status).toBe(201);
            const created = mocks.examPaper.create.mock.calls[0][0].data;
            expect(created.mode).toBe('original');
            expect(created.status).toBe('ready');
            expect(created.difficulty).toBe('original');
            expect(created.questions.create[0]).toMatchObject({
                questionText: '原题', answerText: '答', analysis: '析', figureSvg: '<svg/>',
                figureScale: 65, figureAlign: 'left', answerSpacePx: 240, status: 'ready',
            });
            expect(mocks.generateSimilarQuestion).not.toHaveBeenCalled();
        });

        it('原题直出：findMany 返回乱序时题目 order 仍按 sources 抽题顺序', async () => {
            mocks.subject.findMany.mockResolvedValue([{ id: 's1', name: '数学' }]);
            // selectSourceItems 返回顺序：e3 先被抽中（练习次数最少）
            mocks.errorItem.findMany
                .mockResolvedValueOnce([
                    { id: 'e3', shortId: 'CCCCCC', questionText: '题3', _count: { practiceRecords: 0 } },
                    { id: 'e1', shortId: 'AAAAAA', questionText: '题1', _count: { practiceRecords: 5 } },
                ])
                // 第二次 findMany 返回乱序（数据库默认顺序可能与 sources 不同）
                .mockResolvedValueOnce([
                    { id: 'e1', shortId: 'AAAAAA', questionText: '题1', answerText: '答1', analysis: '析1', figureSvg: null, figureScale: 100, figureAlign: 'center', answerSpacePx: null },
                    { id: 'e3', shortId: 'CCCCCC', questionText: '题3', answerText: '答3', analysis: '析3', figureSvg: null, figureScale: 100, figureAlign: 'center', answerSpacePx: null },
                ]);
            mocks.examPaper.create.mockResolvedValue({ id: 'p1', title: '数学', requestedCount: 2, _count: { questions: 2 } });

            const response = await CREATE(json('http://localhost/api/exams', 'POST', {
                subjectIds: ['s1'], scope: 'all', count: 2, mode: 'original',
            }));

            expect(response.status).toBe(201);
            const created = mocks.examPaper.create.mock.calls[0][0].data;
            // order 应跟随 sources 顺序：e3 在前（练习次数少），e1 在后
            expect(created.questions.create.map((q: { errorItemId: string; order: number }) => [q.errorItemId, q.order]))
                .toEqual([['e3', 1], ['e1', 2]]);
        });

        it('原题直出模式排除无题干文字（含纯空白）的题目，全部被排除时返回 NO_SOURCE_ITEMS', async () => {
            mocks.subject.findMany.mockResolvedValue([{ id: 's1', name: '数学' }]);
            // 只有无题干的题目
            mocks.errorItem.findMany.mockResolvedValue([
                { id: 'e1', shortId: 'AAAAAA', questionText: null, _count: { practiceRecords: 0 } },
                { id: 'e2', shortId: 'BBBBBB', questionText: '   ', _count: { practiceRecords: 0 } },
                { id: 'e3', shortId: 'CCCCCC', questionText: '', _count: { practiceRecords: 0 } },
            ]);

            const response = await CREATE(json('http://localhost/api/exams', 'POST', {
                subjectIds: ['s1'], scope: 'all', count: 2, mode: 'original',
            }));

            expect(response.status).toBe(400);
            expect((await response.json()).message).toBe('NO_SOURCE_ITEMS');
        });

        it('generate 模式缺少 difficulty 时返回 400', async () => {
            const response = await CREATE(json('http://localhost/api/exams', 'POST', {
                subjectIds: ['s1'], scope: 'all', count: 1,
            }));

            expect(response.status).toBe(400);
        });
    });

    it('GET 列表返回生成与录入进度', async () => {
        mocks.examPaper.findMany.mockResolvedValue([{
            id: 'p1',
            title: '测试',
            questions: [{ status: 'ready', _count: { practiceRecords: 2 } }, { status: 'failed', _count: { practiceRecords: 0 } }],
        }]);

        const data = await (await LIST()).json();

        expect(data[0]).toMatchObject({ questionCount: 2, readyCount: 1, recordedCount: 1 });
        expect(data[0]).not.toHaveProperty('questions');
    });

    it('GET 详情不能查看他人的试卷', async () => {
        mocks.examPaper.findUnique.mockResolvedValue({ id: 'p1', userId: 'other', status: 'ready', questions: [] });

        const response = await DETAIL(new Request('http://localhost'), params('p1'));

        expect(response.status).toBe(404);
    });

    it('DELETE 只删除自己的试卷', async () => {
        mocks.examPaper.findUnique.mockResolvedValue({ userId: 'user-1' });

        const response = await DELETE(new Request('http://localhost'), params('p1'));

        expect(response.status).toBe(200);
        expect(mocks.examPaper.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });

    describe('PATCH 保存试卷题目配图比例与显示位置', () => {
        it('单题保存配图比例与位置时只更新指定试卷题目', async () => {
            mocks.examPaper.findUnique.mockResolvedValue({ userId: 'user-1' });
            mocks.examQuestion.updateMany.mockResolvedValue({ count: 1 });

            const response = await UPDATE_SCALE(json('http://localhost', 'PATCH', { questionId: 'q1', figureScale: 65, figureAlign: 'left' }), params('p1'));

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ questionId: 'q1', figureScale: 65, figureAlign: 'left' });
            expect(mocks.examQuestion.updateMany).toHaveBeenCalledWith({
                where: { id: 'q1', paperId: 'p1' },
                data: { figureScale: 65, figureAlign: 'left' },
            });
        });

        it('统一调整配图比例或位置时更新该试卷全部题目', async () => {
            mocks.examPaper.findUnique.mockResolvedValue({ userId: 'user-1' });
            mocks.examQuestion.updateMany.mockResolvedValue({ count: 3 });

            const scaleResponse = await UPDATE_SCALE(json('http://localhost', 'PATCH', { figureScale: 120 }), params('p1'));
            expect(scaleResponse.status).toBe(200);
            expect(await scaleResponse.json()).toEqual({ figureScale: 120 });
            expect(mocks.examQuestion.updateMany).toHaveBeenCalledWith({
                where: { paperId: 'p1' },
                data: { figureScale: 120 },
            });

            const alignResponse = await UPDATE_SCALE(json('http://localhost', 'PATCH', { figureAlign: 'right' }), params('p1'));
            expect(alignResponse.status).toBe(200);
            expect(await alignResponse.json()).toEqual({ figureAlign: 'right' });
            expect(mocks.examQuestion.updateMany).toHaveBeenLastCalledWith({
                where: { paperId: 'p1' },
                data: { figureAlign: 'right' },
            });
        });

        it('保存与清除单题留白，统一清除时更新整卷', async () => {
            mocks.examPaper.findUnique.mockResolvedValue({ userId: 'user-1' });
            mocks.examQuestion.updateMany.mockResolvedValue({ count: 1 });

            const saveResponse = await UPDATE_SCALE(json('http://localhost', 'PATCH', { questionId: 'q1', answerSpacePx: 240 }), params('p1'));
            expect(saveResponse.status).toBe(200);
            expect(mocks.examQuestion.updateMany).toHaveBeenLastCalledWith({ where: { id: 'q1', paperId: 'p1' }, data: { answerSpacePx: 240 } });

            const resetResponse = await UPDATE_SCALE(json('http://localhost', 'PATCH', { answerSpacePx: null }), params('p1'));
            expect(resetResponse.status).toBe(200);
            expect(mocks.examQuestion.updateMany).toHaveBeenLastCalledWith({ where: { paperId: 'p1' }, data: { answerSpacePx: null } });

            for (const answerSpacePx of [-1, 601, 50.5, '120']) {
                expect((await UPDATE_SCALE(json('http://localhost', 'PATCH', { questionId: 'q1', answerSpacePx }), params('p1'))).status).toBe(400);
            }
        });

        it('校验比例范围、显示位置、试卷归属与题目归属', async () => {
            expect((await UPDATE_SCALE(json('http://localhost', 'PATCH', {}), params('p1'))).status).toBe(400);
            expect((await UPDATE_SCALE(json('http://localhost', 'PATCH', { figureScale: 9 }), params('p1'))).status).toBe(400);
            expect((await UPDATE_SCALE(json('http://localhost', 'PATCH', { figureScale: 201 }), params('p1'))).status).toBe(400);
            expect((await UPDATE_SCALE(json('http://localhost', 'PATCH', { figureAlign: 'top' }), params('p1'))).status).toBe(400);

            mocks.examPaper.findUnique.mockResolvedValueOnce({ userId: 'other' });
            expect((await UPDATE_SCALE(json('http://localhost', 'PATCH', { figureScale: 80 }), params('p1'))).status).toBe(404);

            mocks.examPaper.findUnique.mockResolvedValueOnce({ userId: 'user-1' });
            mocks.examQuestion.updateMany.mockResolvedValueOnce({ count: 0 });
            expect((await UPDATE_SCALE(json('http://localhost', 'PATCH', { questionId: 'q-other', figureScale: 80 }), params('p1'))).status).toBe(404);
        });
    });

    describe('POST 录入结果', () => {
        const paper = {
            userId: 'user-1',
            difficulty: 'medium',
            questions: [
                { id: 'q1', errorItemId: 'e1', questionText: '题1', answerText: 'A', analysis: '解1', errorItem: { subject: { name: '数学' } } },
                { id: 'q2', errorItemId: 'e2', questionText: '题2', answerText: 'B', analysis: '解2', errorItem: { subject: { name: '数学' } } },
                { id: 'q3', errorItemId: 'e3', questionText: '题3', answerText: 'C', analysis: '解3', errorItem: null },
                { id: 'q4', errorItemId: null, questionText: '题4', answerText: 'D', analysis: '解4', errorItem: null },
            ],
        };

        it('每次录入为每题新增一条举一反三记录并触发重新评估', async () => {
            mocks.examPaper.findUnique.mockResolvedValue(paper);

            const response = await RESULTS(json('http://localhost', 'POST', {
                takenAt: '2026-10-18T04:00:00.000Z',
                results: [
                    { questionId: 'q1', result: 'correct' },
                    { questionId: 'q2', result: 'not_attempted' },
                    { questionId: 'q3', result: null },
                    { questionId: 'q4', result: 'wrong' },
                ],
            }), params('p1'));

            expect(response.status).toBe(200);
            expect(mocks.tx.practiceRecord.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    userId: 'user-1',
                    errorItemId: 'e1',
                    examQuestionId: 'q1',
                    source: 'exam',
                    result: 'correct',
                    isCorrect: true,
                    difficulty: 'medium',
                    subject: '数学',
                    questionText: '题1',
                    createdAt: new Date('2026-10-18T04:00:00.000Z'),
                }),
            });
            expect(mocks.tx.practiceRecord.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ examQuestionId: 'q2', result: 'not_attempted', isCorrect: false }),
            });
            // 未选择结果、原题已删除的题目不写记录，已有记录不被修改或删除
            expect(mocks.tx.practiceRecord.create).toHaveBeenCalledTimes(2);
            expect(mocks.tx.practiceRecord.update).not.toHaveBeenCalled();
            expect(mocks.tx.practiceRecord.delete).not.toHaveBeenCalled();
            expect(mocks.tx.examPaper.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { resultsRecordedAt: expect.any(Date) } });
            expect(mocks.scheduleMasteryEvaluation).toHaveBeenCalledWith(['e1', 'e2']);
        });

        it('同一题再次录入会追加新记录', async () => {
            mocks.examPaper.findUnique.mockResolvedValue(paper);

            await RESULTS(json('http://localhost', 'POST', { takenAt: '2026-10-18T04:00:00.000Z', results: [{ questionId: 'q1', result: 'wrong' }] }), params('p1'));
            await RESULTS(json('http://localhost', 'POST', { takenAt: '2026-10-19T04:00:00.000Z', results: [{ questionId: 'q1', result: 'correct' }] }), params('p1'));

            expect(mocks.tx.practiceRecord.create).toHaveBeenCalledTimes(2);
            expect(mocks.tx.practiceRecord.create.mock.calls.map(([arg]) => [arg.data.examQuestionId, arg.data.result])).toEqual([['q1', 'wrong'], ['q1', 'correct']]);
        });

        it('他人的试卷返回 404', async () => {
            mocks.examPaper.findUnique.mockResolvedValue({ ...paper, userId: 'other' });

            const response = await RESULTS(json('http://localhost', 'POST', { results: [{ questionId: 'q1', result: 'correct' }] }), params('p1'));

            expect(response.status).toBe(404);
            expect(mocks.transaction).not.toHaveBeenCalled();
        });
    });

    describe('POST 单题重新生成', () => {
        const questionParams = (id: string, questionId: string) => ({ params: Promise.resolve({ id, questionId }) });
        const regenerate = (body: object) => REGENERATE(json('http://localhost', 'POST', body), questionParams('p1', 'q1'));
        const question = (practiceCount: number) => ({
            paperId: 'p1',
            status: 'ready',
            questionText: '旧题',
            paper: { userId: 'user-1', title: '试卷', difficulty: 'hard' },
            errorItem: {
                questionText: '原题', knowledgePoints: null, gradeSemester: '初二上', figureSvg: null,
                tags: [{ name: '函数' }], subject: { name: '数学', stage: 'junior_high', subjectKey: 'math' },
            },
            _count: { practiceRecords: practiceCount },
        });
        const regenerated = { status: 'ready', questionText: '新题', answerText: '新答', analysis: '新析', figureSvg: null, error: null };

        it('未录入结果时重新生成题目和解答，并刷新试卷状态', async () => {
            mocks.examQuestion.findUnique.mockResolvedValueOnce(question(0)).mockResolvedValueOnce(regenerated);
            mocks.generateSimilarQuestion.mockResolvedValue({ questionText: '新题', answerText: '新答', analysis: '新析' });
            mocks.examQuestion.updateMany.mockResolvedValue({ count: 1 });
            mocks.examQuestion.findMany.mockResolvedValue([{ status: 'ready' }, { status: 'ready' }]);

            const response = await regenerate({ mode: 'question', language: 'zh' });

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual(regenerated);
            expect(mocks.generateSimilarQuestion).toHaveBeenCalledWith('原题', ['函数'], 'zh', 'hard', '初二上', null);
            expect(mocks.examQuestion.updateMany).toHaveBeenCalledWith({
                where: { id: 'q1', practiceRecords: { none: {} } },
                data: { status: 'ready', questionText: '新题', answerText: '新答', analysis: '新析', figureSvg: null, error: null },
            });
            expect(mocks.examPaper.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'ready' } });
        });

        it('已录入结果时不能重新生成题目', async () => {
            mocks.examQuestion.findUnique.mockResolvedValueOnce(question(1));

            const response = await regenerate({ mode: 'question' });

            expect(response.status).toBe(409);
            expect((await response.json()).message).toBe('HAS_RESULTS');
            expect(mocks.generateSimilarQuestion).not.toHaveBeenCalled();
        });

        it('生成期间录入了结果时不覆盖题目', async () => {
            mocks.examQuestion.findUnique.mockResolvedValueOnce(question(0));
            mocks.generateSimilarQuestion.mockResolvedValue({ questionText: '新题', answerText: '新答', analysis: '新析' });
            mocks.examQuestion.updateMany.mockResolvedValue({ count: 0 });

            const response = await regenerate({ mode: 'question' });

            expect(response.status).toBe(409);
            expect(mocks.examPaper.update).not.toHaveBeenCalled();
        });

        it('已录入结果时可重新生成解答，并同步录入记录的解答快照', async () => {
            mocks.examQuestion.findUnique.mockResolvedValueOnce(question(2)).mockResolvedValueOnce({ ...regenerated, questionText: '旧题' });
            mocks.reanswerQuestion.mockResolvedValue({ answerText: '新答', analysis: '新析' });

            const response = await regenerate({ mode: 'answer', language: 'en' });

            expect(response.status).toBe(200);
            expect(mocks.reanswerQuestion).toHaveBeenCalledWith('旧题', 'en', expect.any(String), undefined, '初二上');
            const data = { answerText: '新答', analysis: '新析' };
            expect(mocks.examQuestion.update).toHaveBeenCalledWith({ where: { id: 'q1' }, data });
            expect(mocks.practiceRecord.updateMany).toHaveBeenCalledWith({ where: { examQuestionId: 'q1' }, data });
            expect(mocks.generateSimilarQuestion).not.toHaveBeenCalled();
        });

        it('原题已删除时不能重新生成题目', async () => {
            mocks.examQuestion.findUnique.mockResolvedValueOnce({ ...question(0), errorItem: null });

            const response = await regenerate({ mode: 'question' });

            expect(response.status).toBe(400);
            expect((await response.json()).message).toBe('SOURCE_DELETED');
        });

        it('生成中的题目不能重新生成', async () => {
            mocks.examQuestion.findUnique.mockResolvedValueOnce({ ...question(0), status: 'pending' });

            expect((await regenerate({ mode: 'answer' })).status).toBe(409);
        });

        it('不能操作他人试卷或其他试卷的题目', async () => {
            mocks.examQuestion.findUnique.mockResolvedValueOnce({ ...question(0), paper: { ...question(0).paper, userId: 'other' } });
            expect((await regenerate({ mode: 'answer' })).status).toBe(404);

            mocks.examQuestion.findUnique.mockResolvedValueOnce({ ...question(0), paperId: 'p2' });
            expect((await regenerate({ mode: 'answer' })).status).toBe(404);
            expect(mocks.reanswerQuestion).not.toHaveBeenCalled();
        });

        it('校验重新生成方式', async () => {
            expect((await regenerate({ mode: 'all' })).status).toBe(400);
            expect(mocks.examQuestion.findUnique).not.toHaveBeenCalled();
        });

        it('原题直出试卷 mode=question 返回 ORIGINAL_MODE 400，mode=answer 仍允许', async () => {
            const originalQuestion = {
                ...question(0),
                paper: { userId: 'user-1', title: '试卷', difficulty: 'original', mode: 'original' },
            };
            mocks.examQuestion.findUnique.mockResolvedValueOnce(originalQuestion);

            const questionResponse = await regenerate({ mode: 'question' });
            expect(questionResponse.status).toBe(400);
            expect((await questionResponse.json()).message).toBe('ORIGINAL_MODE');
            expect(mocks.generateSimilarQuestion).not.toHaveBeenCalled();

            // answer 模式不受原题限制
            mocks.examQuestion.findUnique
                .mockResolvedValueOnce(originalQuestion)
                .mockResolvedValueOnce({ ...regenerated, questionText: '原题' });
            mocks.reanswerQuestion.mockResolvedValue({ answerText: '新答', analysis: '新析' });

            const answerResponse = await regenerate({ mode: 'answer', language: 'zh' });
            expect(answerResponse.status).toBe(200);
        });
    });

    describe('generateExamPaper', () => {
        it('逐题生成举一反三题目并汇总试卷状态', async () => {
            mocks.examPaper.findUnique.mockResolvedValue({ difficulty: 'hard', questions: [{ id: 'q1' }, { id: 'q2' }] });
            mocks.examQuestion.findUnique
                .mockResolvedValueOnce({ errorItem: { questionText: '原题1', knowledgePoints: null, gradeSemester: null, tags: [{ name: '函数' }] } })
                .mockResolvedValueOnce({ errorItem: null });
            mocks.generateSimilarQuestion.mockResolvedValue({ questionText: '新题', answerText: '答', analysis: '析' });
            mocks.examQuestion.findMany.mockResolvedValue([{ status: 'ready' }, { status: 'failed' }]);

            await generateExamPaper('p1', 'zh');

            expect(mocks.generateSimilarQuestion).toHaveBeenCalledWith('原题1', ['函数'], 'zh', 'hard', null, undefined);
            expect(mocks.examQuestion.update).toHaveBeenCalledWith({
                where: { id: 'q1' },
                data: { status: 'ready', questionText: '新题', answerText: '答', analysis: '析', figureSvg: null, error: null },
            });
            expect(mocks.examQuestion.update).toHaveBeenCalledWith({ where: { id: 'q2' }, data: { status: 'failed', error: 'SOURCE_DELETED' } });
            expect(mocks.examPaper.update).toHaveBeenLastCalledWith({ where: { id: 'p1' }, data: { status: 'partial' } });
        });
    });
});

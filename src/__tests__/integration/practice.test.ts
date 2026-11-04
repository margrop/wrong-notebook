/**
 * /api/practice API 集成测试
 * 测试举一反三功能（生成类似题目和记录练习结果）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockPrismaErrorItem: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
    mockPrismaPracticeRecord: {
        create: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
    },
    mockPrismaUser: {
        findUnique: vi.fn(),
    },
    getCurrentUser: vi.fn(),
    scheduleMasteryEvaluation: vi.fn(),
    mockAIService: {
        generateSimilarQuestion: vi.fn(),
    },
    mockSession: {
        user: {
            id: 'user-123',
            email: 'user@example.com',
            name: 'Test User',
        },
        expires: '2025-12-31',
    },
    mockUser: {
        id: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
    },
}));

// Mock Prisma client
vi.mock('@/lib/prisma', () => ({
    prisma: {
        errorItem: mocks.mockPrismaErrorItem,
        practiceRecord: mocks.mockPrismaPracticeRecord,
        user: mocks.mockPrismaUser,
    },
}));

// Mock AI service
vi.mock('@/lib/ai', () => ({
    getAIService: vi.fn(() => mocks.mockAIService),
}));

// Mock next-auth
vi.mock('next-auth', () => ({
    getServerSession: vi.fn(() => Promise.resolve(mocks.mockSession)),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

vi.mock('@/lib/current-user', () => ({ getCurrentUser: mocks.getCurrentUser }));

vi.mock('@/lib/mastery', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mastery')>()),
    scheduleMasteryEvaluation: mocks.scheduleMasteryEvaluation,
}));

// Import after mocks
import { GET as GENERATE_GET, POST as GENERATE_POST } from '@/app/api/practice/generate/route';
import { POST as RECORD_POST } from '@/app/api/practice/record/route';
import { DELETE as RECORD_DELETE } from '@/app/api/practice/record/[id]/route';
import { getServerSession } from 'next-auth';
import type { Session } from 'next-auth';

describe('/api/practice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
        mocks.mockPrismaUser.findUnique.mockResolvedValue(mocks.mockUser);
    });

    describe('GET /api/practice/generate (读取暂存的举一反三题目)', () => {
        const cached = {
            questionText: '求解 3x = 9',
            answerText: 'x = 3',
            analysis: '两边除以 3',
            subject: '数学',
            figureSvg: null,
            difficulty: 'easy',
            generatedAt: '2026-10-24T08:00:00.000Z',
        };

        it('应该返回最近一次生成的题目', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ userId: 'user-123', lastPractice: JSON.stringify(cached) });

            const response = await GENERATE_GET(new Request('http://localhost/api/practice/generate?errorItemId=error-item-1'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.practice).toEqual(cached);
            expect(mocks.mockAIService.generateSimilarQuestion).not.toHaveBeenCalled();
        });

        it('没有暂存或内容损坏时应返回 null', async () => {
            for (const lastPractice of [null, 'not json', JSON.stringify({ questionText: '' })]) {
                mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ userId: 'user-123', lastPractice });
                const response = await GENERATE_GET(new Request('http://localhost/api/practice/generate?errorItemId=error-item-1'));
                expect(response.status).toBe(200);
                expect((await response.json()).practice).toBeNull();
            }
        });

        it('不能读取他人错题的暂存题目', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ userId: 'other-user', lastPractice: JSON.stringify(cached) });

            const response = await GENERATE_GET(new Request('http://localhost/api/practice/generate?errorItemId=error-item-1'));

            expect(response.status).toBe(404);
        });

        it('未登录应返回 401', async () => {
            vi.mocked(getServerSession).mockResolvedValueOnce(null);

            const response = await GENERATE_GET(new Request('http://localhost/api/practice/generate?errorItemId=error-item-1'));

            expect(response.status).toBe(401);
        });
    });

    describe('POST /api/practice/generate (生成类似题目)', () => {
        const mockErrorItem = {
            id: 'error-item-1',
            userId: 'user-123',
            questionText: '求解 x + 2 = 5',
            knowledgePoints: '["一元一次方程", "移项"]',
            subject: { id: 'math', name: '数学' },
        };

        it('应该成功生成类似题目', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(mockErrorItem);
            const aiResult = {
                questionText: '求解 2x - 3 = 7',
                answerText: 'x = 5',
                analysis: '移项得 2x = 10, x = 5',
                knowledgePoints: ['一元一次方程'],
                subject: '数学',
            };
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue(aiResult);

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'error-item-1',
                    language: 'zh',
                    difficulty: 'medium',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.questionText).toBe('求解 2x - 3 = 7');
            expect(data.subject).toBe('数学');
            expect(data.difficulty).toBe('medium');
            expect(typeof data.generatedAt).toBe('string');
        });

        it('应该暂存最近一次生成的题目与解答', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(mockErrorItem);
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue({
                questionText: '求解 3x = 9',
                answerText: 'x = 3',
                analysis: '两边除以 3',
                knowledgePoints: [],
                figureSvg: '<svg></svg>',
            });

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({ errorItemId: 'error-item-1', language: 'zh', difficulty: 'hard' }),
                headers: { 'Content-Type': 'application/json' },
            });
            const response = await GENERATE_POST(request);

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaErrorItem.update).toHaveBeenCalledWith({
                where: { id: 'error-item-1' },
                data: { lastPractice: expect.any(String) },
            });
            const saved = JSON.parse(mocks.mockPrismaErrorItem.update.mock.calls[0][0].data.lastPractice);
            expect(saved).toMatchObject({
                questionText: '求解 3x = 9',
                answerText: 'x = 3',
                analysis: '两边除以 3',
                subject: '数学',
                figureSvg: '<svg></svg>',
                difficulty: 'hard',
            });
            expect(typeof saved.generatedAt).toBe('string');
        });

        it('暂存失败时仍应返回生成的题目', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(mockErrorItem);
            mocks.mockPrismaErrorItem.update.mockRejectedValueOnce(new Error('db busy'));
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue({
                questionText: '题目', answerText: '答案', analysis: '解析', knowledgePoints: [],
            });

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({ errorItemId: 'error-item-1', language: 'zh' }),
                headers: { 'Content-Type': 'application/json' },
            });
            const response = await GENERATE_POST(request);

            expect(response.status).toBe(200);
            expect((await response.json()).questionText).toBe('题目');
        });

        it('应该支持不同难度级别', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(mockErrorItem);
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue({
                questionText: '简单题目',
                answerText: '答案',
                analysis: '解析',
                knowledgePoints: [],
            });

            const difficulties = ['easy', 'medium', 'hard', 'harder'];

            for (const difficulty of difficulties) {
                const request = new Request('http://localhost/api/practice/generate', {
                    method: 'POST',
                    body: JSON.stringify({
                        errorItemId: 'error-item-1',
                        language: 'zh',
                        difficulty,
                    }),
                    headers: { 'Content-Type': 'application/json' },
                });

                const response = await GENERATE_POST(request);
                expect(response.status).toBe(200);
            }

            // 验证 AI 服务被调用时使用了不同难度
            expect(mocks.mockAIService.generateSimilarQuestion).toHaveBeenCalledTimes(4);
        });

        it('应该默认使用 medium 难度', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(mockErrorItem);
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue({
                questionText: '题目',
                answerText: '答案',
                analysis: '解析',
                knowledgePoints: [],
            });

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'error-item-1',
                    language: 'zh',
                    // 不指定 difficulty
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            await GENERATE_POST(request);

            expect(mocks.mockAIService.generateSimilarQuestion).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Array),
                'zh',
                'medium', // 默认难度
                undefined,
                undefined // 原题无配图
            );
        });

        it('应该返回 404 当错题不存在', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(null);

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'not-exist',
                    language: 'zh',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);
            const data = await response.json();

            expect(response.status).toBe(404);
            expect(data.message).toBe('Item not found');
        });

        it('缺少 errorItemId 时返回 400', async () => {
            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({ language: 'zh' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.message).toBe('errorItemId is required');
            expect(mocks.mockAIService.generateSimilarQuestion).not.toHaveBeenCalled();
        });

        it('difficulty 取值非法时返回 400', async () => {
            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({ errorItemId: 'error-item-1', language: 'zh', difficulty: 'extreme' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);

            expect(response.status).toBe(400);
            expect(mocks.mockAIService.generateSimilarQuestion).not.toHaveBeenCalled();
        });

        it('应该正确解析知识点标签', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(mockErrorItem);
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue({
                questionText: '题目',
                answerText: '答案',
                analysis: '解析',
                knowledgePoints: ['一元一次方程'],
            });

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'error-item-1',
                    language: 'zh',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            await GENERATE_POST(request);

            expect(mocks.mockAIService.generateSimilarQuestion).toHaveBeenCalledWith(
                '求解 x + 2 = 5',
                ['一元一次方程', '移项'], // 解析后的标签数组
                'zh',
                'medium',
                undefined,
                undefined // 原题无配图
            );
        });

        it('不能基于其他用户的错题生成（返回 404，且不调用 AI）', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ ...mockErrorItem, userId: 'other-user' });

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({ errorItemId: 'error-item-1', language: 'zh' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);

            expect(response.status).toBe(404);
            expect(mocks.mockAIService.generateSimilarQuestion).not.toHaveBeenCalled();
        });

        it('应该处理无效的知识点 JSON', async () => {
            const errorItemWithInvalidTags = {
                ...mockErrorItem,
                knowledgePoints: 'invalid json{',
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(errorItemWithInvalidTags);
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue({
                questionText: '题目',
                answerText: '答案',
                analysis: '解析',
                knowledgePoints: [],
            });

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'error-item-1',
                    language: 'zh',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);

            expect(response.status).toBe(200);
            // 应该使用空数组作为标签
            expect(mocks.mockAIService.generateSimilarQuestion).toHaveBeenCalledWith(
                expect.any(String),
                [], // 空数组
                'zh',
                'medium',
                undefined,
                undefined // 原题无配图
            );
        });

        it('应该处理空的知识点', async () => {
            const errorItemWithNoTags = {
                ...mockErrorItem,
                knowledgePoints: null,
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(errorItemWithNoTags);
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue({
                questionText: '题目',
                answerText: '答案',
                analysis: '解析',
                knowledgePoints: [],
            });

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'error-item-1',
                    language: 'zh',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);

            expect(response.status).toBe(200);
        });

        it('应该从数据库获取正确的学科', async () => {
            const errorItemWithPhysics = {
                ...mockErrorItem,
                subject: { id: 'physics', name: '物理' },
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(errorItemWithPhysics);
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue({
                questionText: '物理题目',
                answerText: '答案',
                analysis: '解析',
                knowledgePoints: [],
                subject: undefined, // AI 返回的可能没有学科
            });

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'error-item-1',
                    language: 'zh',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subject).toBe('物理'); // 应该从数据库注入
        });

        it('应该处理未知学科为"其他"', async () => {
            const errorItemWithUnknownSubject = {
                ...mockErrorItem,
                subject: { id: 'unknown', name: '未知学科' },
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(errorItemWithUnknownSubject);
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue({
                questionText: '题目',
                answerText: '答案',
                analysis: '解析',
                knowledgePoints: [],
            });

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'error-item-1',
                    language: 'zh',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subject).toBe('其他');
        });

        it('应该处理没有关联学科的错题', async () => {
            const errorItemWithNoSubject = {
                ...mockErrorItem,
                subject: null,
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(errorItemWithNoSubject);
            mocks.mockAIService.generateSimilarQuestion.mockResolvedValue({
                questionText: '题目',
                answerText: '答案',
                analysis: '解析',
                knowledgePoints: [],
            });

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'error-item-1',
                    language: 'zh',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subject).toBe('其他');
        });

        it('应该处理 AI 服务错误', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(mockErrorItem);
            mocks.mockAIService.generateSimilarQuestion.mockRejectedValue(
                new Error('AI service unavailable')
            );

            const request = new Request('http://localhost/api/practice/generate', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'error-item-1',
                    language: 'zh',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await GENERATE_POST(request);
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('AI service unavailable');
        });
    });

    describe('POST /api/practice/record (记录练习结果)', () => {
        it('直接录入结果：使用指定日期，来源为手动录入并补全错题本名称', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ userId: 'user-123', subject: { name: '数学' } });
            mocks.mockPrismaPracticeRecord.create.mockResolvedValue({ id: 'record-1' });

            const response = await RECORD_POST(new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({ errorItemId: 'error-item-1', result: 'not_attempted', source: 'manual', takenAt: '2026-10-18T04:00:00.000Z' }),
            }));

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaPracticeRecord.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    userId: 'user-123',
                    errorItemId: 'error-item-1',
                    result: 'not_attempted',
                    isCorrect: false,
                    subject: '数学',
                    source: 'manual',
                    createdAt: new Date('2026-10-18T04:00:00.000Z'),
                }),
            });
            expect(mocks.scheduleMasteryEvaluation).toHaveBeenCalledWith(['error-item-1']);
        });

        it('拒绝未知的记录来源', async () => {
            const response = await RECORD_POST(new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({ errorItemId: 'error-item-1', result: 'correct', source: 'exam' }),
            }));

            expect(response.status).toBe(400);
            expect(mocks.mockPrismaPracticeRecord.create).not.toHaveBeenCalled();
        });

        it('举一反三新题的配图净化后随记录保存', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ userId: 'user-123' });
            mocks.mockPrismaPracticeRecord.create.mockResolvedValue({ id: 'record-1' });

            const response = await RECORD_POST(new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    errorItemId: 'error-item-1',
                    result: 'correct',
                    questionText: '新题',
                    figureSvg: '<svg viewBox="0 0 4 4"><script>x()</script><line x1="0" y1="0" x2="4" y2="4"/></svg>',
                }),
            }));

            expect(response.status).toBeLessThan(300);
            const data = mocks.mockPrismaPracticeRecord.create.mock.calls[0][0].data;
            expect(data.figureSvg).toContain('<line');
            expect(data.figureSvg).not.toContain('script');
        });

        it('应该成功记录正确的练习结果', async () => {
            const createdRecord = {
                id: 'record-1',
                userId: 'user-123',
                subject: '数学',
                difficulty: 'medium',
                isCorrect: true,
                createdAt: new Date(),
            };
            mocks.mockPrismaPracticeRecord.create.mockResolvedValue(createdRecord);

            const request = new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    subject: '数学',
                    difficulty: 'medium',
                    isCorrect: true,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await RECORD_POST(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subject).toBe('数学');
            expect(data.isCorrect).toBe(true);
        });

        it('应该成功记录错误的练习结果', async () => {
            const createdRecord = {
                id: 'record-2',
                userId: 'user-123',
                subject: '英语',
                difficulty: 'hard',
                isCorrect: false,
                createdAt: new Date(),
            };
            mocks.mockPrismaPracticeRecord.create.mockResolvedValue(createdRecord);

            const request = new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    subject: '英语',
                    difficulty: 'hard',
                    isCorrect: false,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await RECORD_POST(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.isCorrect).toBe(false);
        });

        it('应该记录不同学科的练习结果', async () => {
            const subjects = ['数学', '物理', '化学', '英语', '语文'];

            for (const subject of subjects) {
                mocks.mockPrismaPracticeRecord.create.mockResolvedValue({
                    id: `record-${subject}`,
                    userId: 'user-123',
                    subject,
                    difficulty: 'medium',
                    isCorrect: true,
                });

                const request = new Request('http://localhost/api/practice/record', {
                    method: 'POST',
                    body: JSON.stringify({
                        subject,
                        difficulty: 'medium',
                        isCorrect: true,
                    }),
                    headers: { 'Content-Type': 'application/json' },
                });

                const response = await RECORD_POST(request);
                expect(response.status).toBe(200);
            }
        });

        it('应该拒绝未登录用户', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);

            const request = new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    subject: '数学',
                    difficulty: 'medium',
                    isCorrect: true,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await RECORD_POST(request);
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Authentication required');
        });

        it('应该拒绝 session 中没有 user 的请求', async () => {
            vi.mocked(getServerSession).mockResolvedValue({
                user: undefined,
                expires: '2025-12-31',
            } as unknown as Session);

            const request = new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    subject: '数学',
                    difficulty: 'medium',
                    isCorrect: true,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await RECORD_POST(request);
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Authentication required');
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaPracticeRecord.create.mockRejectedValue(
                new Error('Database connection failed')
            );

            const request = new Request('http://localhost/api/practice/record', {
                method: 'POST',
                body: JSON.stringify({
                    subject: '数学',
                    difficulty: 'medium',
                    isCorrect: true,
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await RECORD_POST(request);
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to save record');
        });
    });

    describe('DELETE /api/practice/record/:id (删除记录)', () => {
        const params = (id: string) => ({ params: Promise.resolve({ id }) });

        beforeEach(() => {
            mocks.getCurrentUser.mockResolvedValue({ id: 'user-123' });
        });

        it('删除自己的记录并重新评估原题', async () => {
            mocks.mockPrismaPracticeRecord.findUnique.mockResolvedValue({ userId: 'user-123', errorItemId: 'error-item-1' });

            const response = await RECORD_DELETE(new Request('http://localhost'), params('record-1'));

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaPracticeRecord.delete).toHaveBeenCalledWith({ where: { id: 'record-1' } });
            expect(mocks.scheduleMasteryEvaluation).toHaveBeenCalledWith(['error-item-1']);
        });

        it('不能删除他人的记录', async () => {
            mocks.mockPrismaPracticeRecord.findUnique.mockResolvedValue({ userId: 'other', errorItemId: 'error-item-1' });

            const response = await RECORD_DELETE(new Request('http://localhost'), params('record-1'));

            expect(response.status).toBe(404);
            expect(mocks.mockPrismaPracticeRecord.delete).not.toHaveBeenCalled();
        });

        it('未登录返回 401', async () => {
            mocks.getCurrentUser.mockResolvedValue(null);
            vi.mocked(getServerSession).mockResolvedValue(null);

            const response = await RECORD_DELETE(new Request('http://localhost'), params('record-1'));

            expect(response.status).toBe(401);
        });
    });
});

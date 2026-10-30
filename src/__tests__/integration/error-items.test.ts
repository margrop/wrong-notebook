/**
 * /api/error-items API 集成测试
 * 测试错题创建、获取、更新等接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockPrismaUser: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
    },
    mockPrismaErrorItem: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(), // 用于去重检查
        findMany: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
    },
    mockPrismaKnowledgeTag: {
        findFirst: vi.fn(),
        create: vi.fn(),
    },
    mockPrismaSubject: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
    },
    mockSession: {
        user: {
            email: 'user@example.com',
            name: 'Test User',
        },
        expires: '2025-12-31',
    },
}));

// Mock Prisma client
vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: mocks.mockPrismaUser,
        errorItem: mocks.mockPrismaErrorItem,
        knowledgeTag: mocks.mockPrismaKnowledgeTag,
        subject: mocks.mockPrismaSubject,
        $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback({
            user: mocks.mockPrismaUser,
            errorItem: mocks.mockPrismaErrorItem,
            knowledgeTag: mocks.mockPrismaKnowledgeTag,
            subject: mocks.mockPrismaSubject,
        })),
    },
}));

// Mock next-auth
vi.mock('next-auth', () => ({
    getServerSession: vi.fn(() => Promise.resolve(mocks.mockSession)),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

// Mock grade-calculator
vi.mock('@/lib/grade-calculator', () => ({
    calculateGrade: vi.fn(() => '初一，上期'),
}));

// Import after mocks
import { POST } from '@/app/api/error-items/route';
import { GET as GET_ITEM, PUT } from '@/app/api/error-items/[id]/route';
import { GET as GET_LIST } from '@/app/api/error-items/list/route';
import { PATCH as PATCH_NOTES } from '@/app/api/error-items/[id]/notes/route';
import { DELETE as DELETE_ITEM } from '@/app/api/error-items/[id]/delete/route';
import { getServerSession } from 'next-auth';
import { calculateGrade } from '@/lib/grade-calculator';

describe('/api/error-items', () => {
    const mockUser = {
        id: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
        educationStage: 'junior_high',
        enrollmentYear: 2024,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPrismaUser.findUnique.mockResolvedValue(mockUser);
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);

        // Default: subject not found (handle null case)
        mocks.mockPrismaSubject.findUnique.mockResolvedValue(null);

        // Default: knowledgeTag returns a mock tag (used when finding existing tags)
        mocks.mockPrismaKnowledgeTag.findFirst.mockImplementation(async (args: { where?: { name?: string } }) => {
            // Return a mock tag based on the search name
            const name = args?.where?.name;
            if (name) {
                return { id: `tag-${name}`, name, subject: 'math', isSystem: false };
            }
            return null;
        });

        // Default: create returns the created tag
        mocks.mockPrismaKnowledgeTag.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
            id: `tag-new-${Date.now()}`,
            ...args.data,
        }));

        // Default: errorItem.findFirst returns null (no duplicate found)
        mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
        mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
    });

    describe('POST /api/error-items (短 ID 与自动匹配错题本)', () => {
        const baseData = {
            questionText: '求解 x + 2 = 5',
            answerText: 'x = 3',
            analysis: '移项',
            knowledgePoints: [],
            originalImageUrl: '',
        };

        const post = (body: object) => POST(new Request('http://localhost/api/error-items', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        }));

        it('创建时应生成 6 位 base58 短 ID', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'e1', ...args.data }));

            const response = await post(baseData);
            const data = await response.json();

            expect(response.status).toBe(201);
            expect(data.shortId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{6}$/);
        });

        it('未指定错题本时按学科名包含匹配已有错题本', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(null);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([{ id: 'nb-math', name: '初二数学' }]);
            mocks.mockPrismaErrorItem.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'e1', ...args.data }));

            await post({ ...baseData, subjectName: '数学' });

            expect(mocks.mockPrismaSubject.upsert).not.toHaveBeenCalled();
            expect(mocks.mockPrismaErrorItem.create.mock.calls[0][0].data.subjectId).toBe('nb-math');
        });

        it('没有匹配的错题本时新建同名错题本', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(null);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([{ id: 'nb-math', name: '数学' }]);
            mocks.mockPrismaSubject.upsert.mockResolvedValue({ id: 'nb-physics', name: '物理' });
            mocks.mockPrismaErrorItem.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'e1', ...args.data }));

            await post({ ...baseData, subjectName: '物理' });

            expect(mocks.mockPrismaSubject.upsert).toHaveBeenCalledWith(expect.objectContaining({
                // 新错题本学段取用户的教育阶段，学科由名称推断
                create: { name: '物理', userId: 'user-123', stage: 'junior_high', subjectKey: 'physics' },
            }));
            expect(mocks.mockPrismaErrorItem.create.mock.calls[0][0].data.subjectId).toBe('nb-physics');
        });

        it('指定错题本时忽略学科名', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'e1', ...args.data }));

            await post({ ...baseData, subjectId: 'nb-chosen', subjectName: '物理' });

            expect(mocks.mockPrismaSubject.findMany).not.toHaveBeenCalled();
            expect(mocks.mockPrismaErrorItem.create.mock.calls[0][0].data.subjectId).toBe('nb-chosen');
        });
    });

    describe('GET /api/error-items/list 短 ID 搜索', () => {
        it('查询词为短 ID 时同时按短 ID 精确匹配', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            await GET_LIST(new Request('http://localhost/api/error-items/list?query=aB3xYz'));

            const where = mocks.mockPrismaErrorItem.findMany.mock.calls[0][0].where;
            expect(where.AND[0].OR).toContainEqual({ shortId: 'aB3xYz' });
        });

        it('普通查询词不按短 ID 匹配', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            await GET_LIST(new Request('http://localhost/api/error-items/list?query=' + encodeURIComponent('勾股定理')));

            const where = mocks.mockPrismaErrorItem.findMany.mock.calls[0][0].where;
            expect(where.AND[0].OR.some((condition: object) => 'shortId' in condition)).toBe(false);
        });
    });

    describe('POST /api/error-items (创建错题)', () => {
        it.each([[1, 'a'], [2, 'a'], [3, 'a'], [4, 'b'], [5, 'b']] as const)('%i 星的新题保存默认 %s 卷', async (difficultyStars, paperLevel) => {
            mocks.mockPrismaErrorItem.create.mockResolvedValue({ id: 'new-item', userId: 'user-123' });
            const response = await POST(new Request('http://localhost/api/error-items', {
                method: 'POST', body: JSON.stringify({ questionText: '新题', difficultyStars }),
            }));
            expect(response.status).toBe(201);
            expect(mocks.mockPrismaErrorItem.create.mock.calls[0][0].data.paperLevel).toBe(paperLevel);
        });

        it.each(['a', 'b', 'other'])('创建时优先保留手工指定的 %s 卷', async (paperLevel) => {
            mocks.mockPrismaErrorItem.create.mockResolvedValue({ id: 'new-item', userId: 'user-123' });
            const response = await POST(new Request('http://localhost/api/error-items', {
                method: 'POST', body: JSON.stringify({ questionText: '新题', difficultyStars: paperLevel === 'b' ? 2 : 5, paperLevel }),
            }));
            expect(response.status).toBe(201);
            expect(mocks.mockPrismaErrorItem.create.mock.calls[0][0].data.paperLevel).toBe(paperLevel);
        });
        it('应该成功创建错题', async () => {
            const errorItemData = {
                questionText: '求解 x + 2 = 5',
                answerText: 'x = 3',
                analysis: '移项得 x = 5 - 2 = 3',
                knowledgePoints: ['一元一次方程', '移项'],
                originalImageUrl: 'data:image/png;base64,test...',
            };

            const createdItem = {
                id: 'error-item-1',
                ...errorItemData,
                userId: 'user-123',
                masteryLevel: 0,
                createdAt: new Date(),
            };
            mocks.mockPrismaErrorItem.create.mockResolvedValue(createdItem);

            const request = new Request('http://localhost/api/error-items', {
                method: 'POST',
                body: JSON.stringify(errorItemData),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(201);
            expect(data.id).toBe('error-item-1');
            expect(data.questionText).toBe('求解 x + 2 = 5');
        });

        it('保存 AI 识别的难度星级，越界时拒绝创建', async () => {
            mocks.mockPrismaErrorItem.create.mockResolvedValue({ id: 'error-item-1', userId: 'user-123', difficultyStars: 4 });
            const body = { questionText: '鸡兔同笼', answerText: '6', analysis: '假设法', originalImageUrl: '' };

            const ok = await POST(new Request('http://localhost/api/error-items', { method: 'POST', body: JSON.stringify({ ...body, difficultyStars: 4 }) }));
            expect(ok.status).toBe(201);
            expect(mocks.mockPrismaErrorItem.create.mock.calls[0][0].data.difficultyStars).toBe(4);

            for (const difficultyStars of [0, 6, 2.5, '3']) {
                const bad = await POST(new Request('http://localhost/api/error-items', { method: 'POST', body: JSON.stringify({ ...body, difficultyStars }) }));
                expect(bad.status).toBe(400);
            }
            expect(mocks.mockPrismaErrorItem.create).toHaveBeenCalledTimes(1);
        });

        it('保存配图前净化 SVG；有有效配图时标记为有配图', async () => {
            mocks.mockPrismaErrorItem.create.mockResolvedValue({ id: 'error-item-1', userId: 'user-123' });
            const figureSvg = '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><rect width="5" height="5"/></svg>';

            await POST(new Request('http://localhost/api/error-items', {
                method: 'POST',
                body: JSON.stringify({ questionText: '如图', answerText: '答', analysis: '析', originalImageUrl: '', figureSvg }),
            }));

            const data = mocks.mockPrismaErrorItem.create.mock.calls[0][0].data;
            expect(data.hasFigure).toBe(true);
            expect(data.figureSvg).toContain('<rect');
            expect(data.figureSvg).not.toMatch(/script|onload/);
        });

        it('无效 SVG 丢弃，未提供配图时 hasFigure 为 false', async () => {
            mocks.mockPrismaErrorItem.create.mockResolvedValue({ id: 'error-item-1', userId: 'user-123' });

            await POST(new Request('http://localhost/api/error-items', {
                method: 'POST',
                body: JSON.stringify({ questionText: '题', answerText: '答', analysis: '析', originalImageUrl: '', figureSvg: '<div>not svg</div>' }),
            }));
            await POST(new Request('http://localhost/api/error-items', {
                method: 'POST',
                body: JSON.stringify({ questionText: '题2', answerText: '答', analysis: '析', originalImageUrl: '' }),
            }));

            expect(mocks.mockPrismaErrorItem.create.mock.calls[0][0].data).toMatchObject({ hasFigure: false, figureSvg: null });
            expect(mocks.mockPrismaErrorItem.create.mock.calls[1][0].data).toMatchObject({ hasFigure: false, figureSvg: null });
        });

        it('未提供难度星级时保存为空', async () => {
            mocks.mockPrismaErrorItem.create.mockResolvedValue({ id: 'error-item-1', userId: 'user-123' });

            await POST(new Request('http://localhost/api/error-items', {
                method: 'POST',
                body: JSON.stringify({ questionText: '题目', answerText: '答', analysis: '析', originalImageUrl: '' }),
            }));

            expect(mocks.mockPrismaErrorItem.create.mock.calls[0][0].data.difficultyStars).toBeNull();
        });

        it('应该成功创建错题并关联到科目', async () => {
            const errorItemData = {
                questionText: '计算 1 + 1',
                answerText: '2',
                analysis: '简单加法',
                knowledgePoints: ['加法'],
                originalImageUrl: 'data:image/png;base64,test...',
                subjectId: 'subject-math-id',
            };

            const createdItem = {
                id: 'error-item-2',
                ...errorItemData,
                userId: 'user-123',
                masteryLevel: 0,
            };
            mocks.mockPrismaErrorItem.create.mockResolvedValue(createdItem);

            const request = new Request('http://localhost/api/error-items', {
                method: 'POST',
                body: JSON.stringify(errorItemData),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(201);
            expect(data.subjectId).toBe('subject-math-id');
        });

        it('应该成功创建错题并设置年级学期', async () => {
            const errorItemData = {
                questionText: '求解方程',
                answerText: 'x = 5',
                analysis: '解析',
                knowledgePoints: ['方程'],
                originalImageUrl: 'data:image/png;base64,test...',
                gradeSemester: '初一上期',
                paperLevel: 'A',
            };

            const createdItem = {
                id: 'error-item-3',
                ...errorItemData,
                userId: 'user-123',
                masteryLevel: 0,
            };
            mocks.mockPrismaErrorItem.create.mockResolvedValue(createdItem);

            const request = new Request('http://localhost/api/error-items', {
                method: 'POST',
                body: JSON.stringify(errorItemData),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(201);
            expect(data.gradeSemester).toBe('初一上期');
            expect(data.paperLevel).toBe('A');
        });

        it('应该拒绝未登录用户创建错题', async () => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue(null);
            mocks.mockPrismaUser.findFirst.mockResolvedValue(null);

            const request = new Request('http://localhost/api/error-items', {
                method: 'POST',
                body: JSON.stringify({
                    questionText: 'test',
                    originalImageUrl: 'test',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBeDefined(); // 可能返回不同的消息
        });

        it('应该自动计算年级学期（如果未提供）', async () => {
            const errorItemData = {
                questionText: '题目',
                answerText: '答案',
                analysis: '解析',
                knowledgePoints: ['知识点'],
                originalImageUrl: 'data:image/png;base64,test...',
                // 不提供 gradeSemester，应该自动计算
            };

            mocks.mockPrismaErrorItem.create.mockResolvedValue({
                id: 'error-item-4',
                ...errorItemData,
                userId: 'user-123',
                gradeSemester: '初一，上期',
                masteryLevel: 0,
            });

            const request = new Request('http://localhost/api/error-items', {
                method: 'POST',
                body: JSON.stringify(errorItemData),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(201);
            // 验证 create 被调用时包含了计算后的 gradeSemester
            expect(mocks.mockPrismaErrorItem.create).toHaveBeenCalled();
            // 年级学期按中文保存，与识别、重新标注时一致
            expect(calculateGrade).toHaveBeenCalledWith('junior_high', 2024, expect.any(Date), 'zh', expect.any(String));
        });

        it('应该正确处理字符串格式的知识点', async () => {
            const errorItemData = {
                questionText: '题目',
                answerText: '答案',
                analysis: '解析',
                knowledgePoints: '一元一次方程, 移项',
                originalImageUrl: 'data:image/png;base64,test...',
            };

            mocks.mockPrismaErrorItem.create.mockResolvedValue({
                id: 'error-item-5',
                ...errorItemData,
                userId: 'user-123',
                masteryLevel: 0,
            });

            const request = new Request('http://localhost/api/error-items', {
                method: 'POST',
                body: JSON.stringify(errorItemData),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(201);
        });
    });

    describe('GET /api/error-items/[id] (获取单个错题)', () => {
        it('应该返回错题详情', async () => {
            const errorItem = {
                id: 'error-item-1',
                userId: 'user-123',
                questionText: '求解 x + 2 = 5',
                answerText: 'x = 3',
                analysis: '移项得 x = 5 - 2 = 3',
                knowledgePoints: '["一元一次方程", "移项"]',
                originalImageUrl: 'data:image/png;base64,test...',
                masteryLevel: 0,
                subject: { id: 'math', name: '数学' },
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(errorItem);

            const request = new Request('http://localhost/api/error-items/error-item-1');
            const response = await GET_ITEM(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.questionText).toBe('求解 x + 2 = 5');
            expect(data.subject.name).toBe('数学');
        });

        it('应该返回 404 当错题不存在', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(null);

            const request = new Request('http://localhost/api/error-items/not-exist');
            const response = await GET_ITEM(request, { params: Promise.resolve({ id: 'not-exist' }) });
            const data = await response.json();

            expect(response.status).toBe(404);
            expect(data.message).toBe('Item not found');
        });

        it('应该拒绝访问其他用户的错题', async () => {
            const errorItem = {
                id: 'error-item-1',
                userId: 'other-user-id', // 不同的用户
                questionText: '其他人的错题',
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(errorItem);

            const request = new Request('http://localhost/api/error-items/error-item-1');
            const response = await GET_ITEM(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(403);
            expect(data.message).toContain('Not authorized');
        });
    });

    describe('PUT /api/error-items/[id] (更新错题)', () => {
        it('未设置卷别的题目补评为 4 星时默认归 B 卷', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ id: 'e1', userId: 'user-123', paperLevel: null });
            mocks.mockPrismaErrorItem.update.mockResolvedValue({ id: 'e1' });
            const response = await PUT(new Request('http://localhost/api/error-items/e1', { method: 'PUT', body: JSON.stringify({ difficultyStars: 4 }) }), { params: Promise.resolve({ id: 'e1' }) });
            expect(response.status).toBe(200);
            expect(mocks.mockPrismaErrorItem.update.mock.calls[0][0].data).toMatchObject({ difficultyStars: 4, paperLevel: 'b' });
        });

        it.each(['a', 'b', 'other'])('补评星级时保留已有 %s 卷', async (paperLevel) => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ id: 'e1', userId: 'user-123', paperLevel });
            mocks.mockPrismaErrorItem.update.mockResolvedValue({ id: 'e1' });
            await PUT(new Request('http://localhost/api/error-items/e1', { method: 'PUT', body: JSON.stringify({ difficultyStars: paperLevel === 'b' ? 2 : 5 }) }), { params: Promise.resolve({ id: 'e1' }) });
            expect(mocks.mockPrismaErrorItem.update.mock.calls[0][0].data).not.toHaveProperty('paperLevel');
        });
        it('只保存错因分析时沿用原作答状态', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ id: 'e1', userId: 'user-123', wrongAnswerText: null, mistakeAnalysis: null, mistakeStatus: 'not_attempted' });
            mocks.mockPrismaErrorItem.update.mockResolvedValue({ id: 'e1' });
            await PUT(new Request('http://localhost/api/error-items/e1', { method: 'PUT', body: JSON.stringify({ mistakeAnalysis: '概念不清' }) }), { params: Promise.resolve({ id: 'e1' }) });
            const data = mocks.mockPrismaErrorItem.update.mock.calls[0][0].data;
            expect(data).toMatchObject({ mistakeAnalysis: '概念不清', mistakeStatus: 'not_attempted' });
            expect(data).not.toHaveProperty('wrongAnswerText');
        });

        it('应该成功更新知识点', async () => {
            const existingItem = {
                id: 'error-item-1',
                userId: 'user-123',
                knowledgePoints: '["旧知识点"]',
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(existingItem);
            mocks.mockPrismaErrorItem.update.mockResolvedValue({
                ...existingItem,
                knowledgePoints: '["新知识点1", "新知识点2"]',
            });

            const request = new Request('http://localhost/api/error-items/error-item-1', {
                method: 'PUT',
                body: JSON.stringify({ knowledgePoints: '["新知识点1", "新知识点2"]' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PUT(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.knowledgePoints).toContain('新知识点1');
        });

        it('应该成功更新年级学期', async () => {
            const existingItem = {
                id: 'error-item-1',
                userId: 'user-123',
                gradeSemester: '初一上期',
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(existingItem);
            mocks.mockPrismaErrorItem.update.mockResolvedValue({
                ...existingItem,
                gradeSemester: '初二下期',
            });

            const request = new Request('http://localhost/api/error-items/error-item-1', {
                method: 'PUT',
                body: JSON.stringify({ gradeSemester: '初二下期' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PUT(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.gradeSemester).toBe('初二下期');
        });

        it('应该成功更新试卷等级', async () => {
            const existingItem = {
                id: 'error-item-1',
                userId: 'user-123',
                paperLevel: 'A',
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(existingItem);
            mocks.mockPrismaErrorItem.update.mockResolvedValue({
                ...existingItem,
                paperLevel: 'B',
            });

            const request = new Request('http://localhost/api/error-items/error-item-1', {
                method: 'PUT',
                body: JSON.stringify({ paperLevel: 'B' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PUT(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.paperLevel).toBe('B');
        });

        it('可以手动修改和清除难度星级，非法值返回 400', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ id: 'error-item-1', userId: 'user-123', difficultyStars: 2 });
            mocks.mockPrismaErrorItem.update.mockResolvedValue({ id: 'error-item-1', userId: 'user-123' });
            const put = (difficultyStars: unknown) => PUT(new Request('http://localhost/api/error-items/error-item-1', {
                method: 'PUT',
                body: JSON.stringify({ difficultyStars }),
            }), { params: Promise.resolve({ id: 'error-item-1' }) });

            expect((await put(5)).status).toBe(200);
            expect(mocks.mockPrismaErrorItem.update.mock.calls[0][0].data.difficultyStars).toBe(5);
            expect((await put(null)).status).toBe(200);
            expect(mocks.mockPrismaErrorItem.update.mock.calls[1][0].data.difficultyStars).toBeNull();
            for (const value of [0, 6, 1.5, '4']) {
                expect((await put(value)).status).toBe(400);
            }
            expect(mocks.mockPrismaErrorItem.update).toHaveBeenCalledTimes(2);
        });

        it('应该拒绝更新其他用户的错题', async () => {
            const existingItem = {
                id: 'error-item-1',
                userId: 'other-user-id', // 不同的用户
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(existingItem);

            const request = new Request('http://localhost/api/error-items/error-item-1', {
                method: 'PUT',
                body: JSON.stringify({ knowledgePoints: '["test"]' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PUT(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(403);
            expect(data.message).toContain('Not authorized');
        });

        it('应该返回 404 当错题不存在', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(null);

            const request = new Request('http://localhost/api/error-items/not-exist', {
                method: 'PUT',
                body: JSON.stringify({ knowledgePoints: '["test"]' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PUT(request, { params: Promise.resolve({ id: 'not-exist' }) });
            const data = await response.json();

            expect(response.status).toBe(404);
            expect(data.message).toBe('Item not found');
        });
    });

    describe('GET /api/error-items/list (获取错题列表)', () => {
        it('应该返回用户的错题（分页响应）', async () => {
            const errorItems = [
                { id: '1', questionText: '题目1', userId: 'user-123', _count: { practiceRecords: 0 } },
                { id: '2', questionText: '题目2', userId: 'user-123', _count: { practiceRecords: 0 } },
            ];
            mocks.mockPrismaErrorItem.count.mockResolvedValue(2);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue(errorItems);

            const request = new Request('http://localhost/api/error-items/list');
            const response = await GET_LIST(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.items).toHaveLength(2);
            expect(data.total).toBe(2);
            expect(data.page).toBe(1);
            expect(data.pageSize).toBe(18);
            expect(data.totalPages).toBe(1);
        });

        it('应该支持按科目筛选', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(1);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([
                { id: '1', questionText: '数学题', subjectId: 'math-id', _count: { practiceRecords: 0 } },
            ]);

            const request = new Request('http://localhost/api/error-items/list?subjectId=math-id');
            const response = await GET_LIST(request);

            expect(response.status).toBe(200);
            // 验证查询时使用了 subjectId 筛选
            expect(mocks.mockPrismaErrorItem.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        subjectId: 'math-id',
                    }),
                })
            );
        });

        it('应该支持搜索查询', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            const request = new Request('http://localhost/api/error-items/list?query=方程');
            const response = await GET_LIST(request);

            expect(response.status).toBe(200);
            // 搜索条件现在被包装在 AND 数组中，以便与其他筛选条件正确组合
            expect(mocks.mockPrismaErrorItem.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        AND: expect.arrayContaining([
                            expect.objectContaining({
                                OR: expect.any(Array),
                            }),
                        ]),
                    }),
                })
            );
        });

        it.each([
            ['new', { practiceRecords: { none: { result: { not: null } } } }],
            ['reviewing', {
                practiceRecords: { some: { result: { not: null } } },
                OR: [{ masteryProbability: null }, { masteryProbability: { lt: 0.5 } }],
            }],
            ['mastered', { practiceRecords: { some: { result: { not: null } } }, masteryProbability: { gte: 0.5 } }],
        ])('应该支持按复习状态 %s 筛选', async (status, condition) => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            const request = new Request(`http://localhost/api/error-items/list?mastery=${status}`);
            const response = await GET_LIST(request);

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaErrorItem.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ AND: [condition] }),
                })
            );
        });

        it('列表应返回每道题的复习状态', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(3);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([
                { id: 'a', masteryProbability: null, _count: { practiceRecords: 0 } },
                { id: 'b', masteryProbability: 0.49, _count: { practiceRecords: 2 } },
                { id: 'c', masteryProbability: 0.5, _count: { practiceRecords: 1 } },
            ]);

            const response = await GET_LIST(new Request('http://localhost/api/error-items/list'));
            const data = await response.json();

            expect(data.items.map((item: { masteryStatus: string }) => item.masteryStatus)).toEqual(['new', 'reviewing', 'mastered']);
            expect(data.items[0]).not.toHaveProperty('_count');
        });

        it('应该支持按知识点标签筛选', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            const request = new Request('http://localhost/api/error-items/list?tag=一元一次方程');
            const response = await GET_LIST(request);

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaErrorItem.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        knowledgePoints: { contains: '一元一次方程' },
                    }),
                })
            );
        });

        it('应该支持按时间范围筛选（最近一周）', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            const request = new Request('http://localhost/api/error-items/list?timeRange=week');
            const response = await GET_LIST(request);

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaErrorItem.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        createdAt: expect.objectContaining({
                            gte: expect.any(Date),
                        }),
                    }),
                })
            );
        });

        it('应该支持按试卷等级筛选', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            const request = new Request('http://localhost/api/error-items/list?paperLevel=A');
            const response = await GET_LIST(request);

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaErrorItem.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        paperLevel: 'A',
                    }),
                })
            );
        });
    });

    describe('PATCH /api/error-items/[id]/notes (更新笔记)', () => {
        beforeEach(() => {
            // 默认题目属于当前用户
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ userId: 'user-123' });
        });

        it('不能修改其他用户题目的笔记', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({ userId: 'other-user' });

            const request = new Request('http://localhost/api/error-items/error-item-1/notes', {
                method: 'PATCH',
                body: JSON.stringify({ userNotes: '篡改' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH_NOTES(request, { params: Promise.resolve({ id: 'error-item-1' }) });

            expect(response.status).toBe(404);
            expect(mocks.mockPrismaErrorItem.update).not.toHaveBeenCalled();
        });

        it('笔记不是字符串时返回 400', async () => {
            const request = new Request('http://localhost/api/error-items/error-item-1/notes', {
                method: 'PATCH',
                body: JSON.stringify({ userNotes: { html: '<b>x</b>' } }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH_NOTES(request, { params: Promise.resolve({ id: 'error-item-1' }) });

            expect(response.status).toBe(400);
            expect(mocks.mockPrismaErrorItem.update).not.toHaveBeenCalled();
        });

        it('应该成功更新用户笔记', async () => {
            const existingItem = {
                id: 'error-item-1',
                userId: 'user-123',
                userNotes: '',
            };
            mocks.mockPrismaErrorItem.update.mockResolvedValue({
                ...existingItem,
                userNotes: '这道题需要注意移项变号',
            });

            const request = new Request('http://localhost/api/error-items/error-item-1/notes', {
                method: 'PATCH',
                body: JSON.stringify({ userNotes: '这道题需要注意移项变号' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH_NOTES(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.userNotes).toBe('这道题需要注意移项变号');
        });

        it('应该成功清空笔记', async () => {
            const existingItem = {
                id: 'error-item-1',
                userId: 'user-123',
                userNotes: '旧笔记内容',
            };
            mocks.mockPrismaErrorItem.update.mockResolvedValue({
                ...existingItem,
                userNotes: '',
            });

            const request = new Request('http://localhost/api/error-items/error-item-1/notes', {
                method: 'PATCH',
                body: JSON.stringify({ userNotes: '' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH_NOTES(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.userNotes).toBe('');
        });

        it('应该成功保存长笔记', async () => {
            const longNote = '这是一段很长的笔记内容。'.repeat(100);
            mocks.mockPrismaErrorItem.update.mockResolvedValue({
                id: 'error-item-1',
                userId: 'user-123',
                userNotes: longNote,
            });

            const request = new Request('http://localhost/api/error-items/error-item-1/notes', {
                method: 'PATCH',
                body: JSON.stringify({ userNotes: longNote }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH_NOTES(request, { params: Promise.resolve({ id: 'error-item-1' }) });

            expect(response.status).toBe(200);
        });

        it('应该拒绝未登录用户', async () => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue(null);
            mocks.mockPrismaUser.findFirst.mockResolvedValue(null);

            const request = new Request('http://localhost/api/error-items/error-item-1/notes', {
                method: 'PATCH',
                body: JSON.stringify({ userNotes: '笔记' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH_NOTES(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBeDefined();
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaErrorItem.update.mockRejectedValue(new Error('Database error'));

            const request = new Request('http://localhost/api/error-items/error-item-1/notes', {
                method: 'PATCH',
                body: JSON.stringify({ userNotes: '笔记' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH_NOTES(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to update notes');
        });
    });

    describe('DELETE /api/error-items/[id]/delete (删除错题)', () => {
        it('应该成功删除自己的错题', async () => {
            const existingItem = {
                id: 'error-item-1',
                userId: 'user-123',
                questionText: '要删除的错题',
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(existingItem);
            mocks.mockPrismaErrorItem.delete.mockResolvedValue(existingItem);

            const request = new Request('http://localhost/api/error-items/error-item-1/delete', {
                method: 'DELETE',
            });

            const response = await DELETE_ITEM(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.message).toBe('Deleted successfully');
            expect(mocks.mockPrismaErrorItem.delete).toHaveBeenCalledWith({
                where: { id: 'error-item-1' },
            });
        });

        it('应该返回 404 当错题不存在', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(null);

            const request = new Request('http://localhost/api/error-items/not-exist/delete', {
                method: 'DELETE',
            });

            const response = await DELETE_ITEM(request, { params: Promise.resolve({ id: 'not-exist' }) });
            const data = await response.json();

            expect(response.status).toBe(404);
            expect(data.message).toBe('Item not found');
            expect(mocks.mockPrismaErrorItem.delete).not.toHaveBeenCalled();
        });

        it('应该拒绝删除其他用户的错题', async () => {
            const existingItem = {
                id: 'error-item-1',
                userId: 'other-user-id', // 不同的用户
                questionText: '其他人的错题',
            };
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue(existingItem);

            const request = new Request('http://localhost/api/error-items/error-item-1/delete', {
                method: 'DELETE',
            });

            const response = await DELETE_ITEM(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(403);
            expect(data.message).toContain('Not authorized');
            expect(mocks.mockPrismaErrorItem.delete).not.toHaveBeenCalled();
        });

        it('应该拒绝未登录用户', async () => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue(null);
            mocks.mockPrismaUser.findFirst.mockResolvedValue(null);

            const request = new Request('http://localhost/api/error-items/error-item-1/delete', {
                method: 'DELETE',
            });

            const response = await DELETE_ITEM(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBeDefined();
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaErrorItem.findUnique.mockResolvedValue({
                id: 'error-item-1',
                userId: 'user-123',
            });
            mocks.mockPrismaErrorItem.delete.mockRejectedValue(new Error('Database error'));

            const request = new Request('http://localhost/api/error-items/error-item-1/delete', {
                method: 'DELETE',
            });

            const response = await DELETE_ITEM(request, { params: Promise.resolve({ id: 'error-item-1' }) });
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to delete error item');
        });
    });
});

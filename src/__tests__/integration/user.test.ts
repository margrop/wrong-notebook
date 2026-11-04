/**
 * /api/user API 集成测试
 * 测试用户信息获取和更新接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockPrismaUser: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
    mockPrismaErrorItem: {
        updateMany: vi.fn(async () => ({ count: 0 })),
    },
    mockSession: {
        user: {
            email: 'test@example.com',
            name: 'Test User',
        },
    },
}));

// Mock Prisma client
vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: mocks.mockPrismaUser,
        $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({ user: mocks.mockPrismaUser, errorItem: mocks.mockPrismaErrorItem })),
    },
}));

// Mock next-auth
vi.mock('next-auth', () => ({
    getServerSession: vi.fn(() => Promise.resolve(mocks.mockSession)),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
    hash: vi.fn((password: string) => Promise.resolve(`hashed_${password}`)),
}));

// Import after mocks
import { GET, PATCH } from '@/app/api/user/route';
import type { Session } from 'next-auth';

describe('/api/user', () => {
    const defaultDbUser = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // withUser 包装器通过 prisma 查询用户，设置默认返回值
        mocks.mockPrismaUser.findUnique.mockResolvedValue(defaultDbUser);
    });

    describe('GET /api/user', () => {
        it('应该返回用户信息', async () => {
            const mockUser = {
                name: 'Test User',
                email: 'test@example.com',
                educationStage: 'junior_high',
                enrollmentYear: 2024,
            };
            mocks.mockPrismaUser.findUnique.mockResolvedValue(mockUser);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.name).toBe('Test User');
            expect(data.email).toBe('test@example.com');
            expect(data.educationStage).toBe('junior_high');
        });

        it('应该返回 404 当用户不存在', async () => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue(null);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(404);
            expect(data.message).toBe('User not found');
        });
    });

    describe('PATCH /api/user', () => {
        it('应该更新「导入前人工确认」偏好，包括关闭', async () => {
            mocks.mockPrismaUser.update.mockResolvedValue({ confirmBeforeImport: false });

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ confirmBeforeImport: false }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaUser.update.mock.calls[0][0].data).toEqual({ confirmBeforeImport: false });
            expect(mocks.mockPrismaUser.update.mock.calls[0][0].select.confirmBeforeImport).toBe(true);
        });

        it('应该更新「GeoGebra 动态演示」偏好，并在响应中返回该字段', async () => {
            mocks.mockPrismaUser.update.mockResolvedValue({ enableGeogebra: true });

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ enableGeogebra: true }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaUser.update.mock.calls[0][0].data).toEqual({ enableGeogebra: true });
            expect(mocks.mockPrismaUser.update.mock.calls[0][0].select.enableGeogebra).toBe(true);
        });

        it('应该更新「SVG 动画讲解」偏好，并在响应中返回该字段', async () => {
            mocks.mockPrismaUser.update.mockResolvedValue({ enableSvgAnimation: false });

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ enableSvgAnimation: false }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaUser.update.mock.calls[0][0].data).toEqual({ enableSvgAnimation: false });
            expect(mocks.mockPrismaUser.update.mock.calls[0][0].select.enableSvgAnimation).toBe(true);
        });

        it('应该更新界面主题偏好，并在响应中返回该字段', async () => {
            mocks.mockPrismaUser.update.mockResolvedValue({ themePreference: 'dark' });

            const response = await PATCH(new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ themePreference: 'dark' }),
                headers: { 'Content-Type': 'application/json' },
            }));

            expect(response.status).toBe(200);
            expect(mocks.mockPrismaUser.update.mock.calls[0][0].data).toEqual({ themePreference: 'dark' });
            expect(mocks.mockPrismaUser.update.mock.calls[0][0].select.themePreference).toBe(true);
        });

        it('应该拒绝不支持的主题偏好', async () => {
            const response = await PATCH(new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ themePreference: 'purple' }),
                headers: { 'Content-Type': 'application/json' },
            }));

            expect(response.status).toBe(400);
            expect(mocks.mockPrismaUser.update).not.toHaveBeenCalled();
        });

        it('应该更新已掌握阈值，并按新阈值同步错题的 masteryLevel', async () => {
            mocks.mockPrismaUser.update.mockResolvedValue({ id: 'user-1', masteryThreshold: 80 });

            const response = await PATCH(new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ masteryThreshold: 80 }),
                headers: { 'Content-Type': 'application/json' },
            }));

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ masteryThreshold: 80 });
            expect(mocks.mockPrismaUser.update.mock.calls[0][0].data).toEqual({ masteryThreshold: 80 });
            const syncCalls = mocks.mockPrismaErrorItem.updateMany.mock.calls as unknown as [{ where: unknown; data: unknown }][];
            expect(syncCalls.map(([args]) => args)).toEqual(expect.arrayContaining([
                expect.objectContaining({ where: { AND: expect.arrayContaining([{ userId: 'user-1', masteryLevel: { not: 2 } }, expect.objectContaining({ masteryProbability: { gte: 0.8 } })]) }, data: { masteryLevel: 2 } }),
                expect.objectContaining({ data: { masteryLevel: 1 } }),
            ]));
        });

        it('未修改已掌握阈值时不同步 masteryLevel', async () => {
            mocks.mockPrismaUser.update.mockResolvedValue({ id: 'user-1', name: 'New Name' });

            await PATCH(new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'New Name' }),
                headers: { 'Content-Type': 'application/json' },
            }));

            expect(mocks.mockPrismaErrorItem.updateMany).not.toHaveBeenCalled();
        });

        it.each([0, 101, 50.5, '60'])('已掌握阈值为 %s 时拒绝更新', async (value) => {
            const response = await PATCH(new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ masteryThreshold: value }),
                headers: { 'Content-Type': 'application/json' },
            }));

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(mocks.mockPrismaUser.update).not.toHaveBeenCalled();
        });

        it('GeoGebra 偏好不是布尔值时拒绝更新', async () => {
            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ enableGeogebra: 'yes' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);

            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(mocks.mockPrismaUser.update).not.toHaveBeenCalled();
        });

        it('应该成功更新用户名', async () => {
            const updatedUser = {
                name: 'New Name',
                email: 'test@example.com',
                educationStage: 'junior_high',
                enrollmentYear: 2024,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'New Name' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.name).toBe('New Name');
        });

        it('应该成功更新教育阶段', async () => {
            const updatedUser = {
                name: 'Test User',
                email: 'test@example.com',
                educationStage: 'senior_high',
                enrollmentYear: 2024,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ educationStage: 'senior_high' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.educationStage).toBe('senior_high');
        });

        it('应该成功更新入学年份', async () => {
            const updatedUser = {
                name: 'Test User',
                email: 'test@example.com',
                educationStage: 'junior_high',
                enrollmentYear: 2025,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ enrollmentYear: 2025 }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.enrollmentYear).toBe(2025);
        });

        it('应该忽略空字符串字段', async () => {
            const updatedUser = {
                name: 'Test User',
                email: 'test@example.com',
                educationStage: 'junior_high',
                enrollmentYear: 2024,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ name: '', email: '', educationStage: '' }),
                headers: { 'Content-Type': 'application/json' },
            });

            await PATCH(request);

            // 验证 update 被调用时，空字段不应该出现在 data 中
            expect(mocks.mockPrismaUser.update).toHaveBeenCalled();
            const updateCall = mocks.mockPrismaUser.update.mock.calls[0][0];
            expect(updateCall.data).not.toHaveProperty('name');
            expect(updateCall.data).not.toHaveProperty('email');
        });

        it('应该拒绝太短的密码', async () => {
            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ password: '123' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.message).toBe('Password must be at least 6 characters');
        });

        it('应该成功更新密码（>=6字符）', async () => {
            const updatedUser = {
                name: 'Test User',
                email: 'test@example.com',
                educationStage: 'junior_high',
                enrollmentYear: 2024,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ password: 'newpassword123' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);

            expect(response.status).toBe(200);
            // 验证密码被哈希处理
            const updateCall = mocks.mockPrismaUser.update.mock.calls[0][0];
            expect(updateCall.data.password).toBe('hashed_newpassword123');
        });

        it('应该接受 admin@localhost 邮箱格式', async () => {
            const updatedUser = {
                name: 'Admin',
                email: 'admin@localhost',
                educationStage: 'junior_high',
                enrollmentYear: 2025,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ email: 'admin@localhost' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.email).toBe('admin@localhost');
        });

        it('应该接受标准邮箱格式', async () => {
            const updatedUser = {
                name: 'User',
                email: 'user@example.com',
                educationStage: 'junior_high',
                enrollmentYear: 2025,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ email: 'user@example.com' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);

            expect(response.status).toBe(200);
        });

        it('应该拒绝无效邮箱格式', async () => {
            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ email: 'invalid-email' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.message).toBe('Invalid email format');
        });
    });

    describe('角色权限测试', () => {
        it('管理员用户应该可以修改自己的信息', async () => {
            // 模拟管理员 session
            const { getServerSession } = await import('next-auth');
            vi.mocked(getServerSession).mockResolvedValue({
                user: {
                    email: 'admin@localhost',
                    name: 'Admin',
                    role: 'admin',
                },
                expires: '2025-12-31',
            });

            const updatedUser = {
                name: 'Updated Admin',
                email: 'admin@localhost',
                educationStage: 'junior_high',
                enrollmentYear: 2025,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'Updated Admin', educationStage: 'junior_high' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.name).toBe('Updated Admin');
        });

        it('普通用户应该可以修改自己的信息', async () => {
            // 模拟普通用户 session
            const { getServerSession } = await import('next-auth');
            vi.mocked(getServerSession).mockResolvedValue({
                user: {
                    email: 'user@example.com',
                    name: 'Normal User',
                    role: 'user',
                },
                expires: '2025-12-31',
            });

            const updatedUser = {
                name: 'Updated User',
                email: 'user@example.com',
                educationStage: 'senior_high',
                enrollmentYear: 2024,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'Updated User', educationStage: 'senior_high' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.name).toBe('Updated User');
            expect(data.educationStage).toBe('senior_high');
        });

        it('未登录用户应该被拒绝访问 GET', async () => {
            const { getServerSession } = await import('next-auth');
            vi.mocked(getServerSession).mockResolvedValue(null);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('未登录用户应该被拒绝访问 PATCH', async () => {
            const { getServerSession } = await import('next-auth');
            vi.mocked(getServerSession).mockResolvedValue(null);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'Hacker' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Authentication required');
        });

        it('session 中没有 email 的用户应该被拒绝', async () => {
            const { getServerSession } = await import('next-auth');
            vi.mocked(getServerSession).mockResolvedValue({
                user: {
                    name: 'No Email User',
                },
                expires: '2025-12-31',
            } as unknown as Session);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('管理员可以修改密码', async () => {
            const { getServerSession } = await import('next-auth');
            vi.mocked(getServerSession).mockResolvedValue({
                user: {
                    email: 'admin@localhost',
                    name: 'Admin',
                    role: 'admin',
                },
                expires: '2025-12-31',
            });

            const updatedUser = {
                name: 'Admin',
                email: 'admin@localhost',
                educationStage: 'junior_high',
                enrollmentYear: 2025,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ password: 'newAdminPassword123' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);

            expect(response.status).toBe(200);
            // 验证密码被哈希
            const updateCall = mocks.mockPrismaUser.update.mock.calls[0][0];
            expect(updateCall.data.password).toBe('hashed_newAdminPassword123');
        });

        it('管理员不能把密码改回默认密码', async () => {
            const { getServerSession } = await import('next-auth');
            vi.mocked(getServerSession).mockResolvedValue({
                user: { email: 'admin@localhost', name: 'Admin', role: 'admin' },
                expires: '2025-12-31',
            });

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ password: '123456' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.message).toBe('New password must not be the default password');
            expect(mocks.mockPrismaUser.update).not.toHaveBeenCalled();
        });

        it('普通用户可以修改密码', async () => {
            const { getServerSession } = await import('next-auth');
            vi.mocked(getServerSession).mockResolvedValue({
                user: {
                    email: 'user@example.com',
                    name: 'Normal User',
                    role: 'user',
                },
                expires: '2025-12-31',
            });

            const updatedUser = {
                name: 'Normal User',
                email: 'user@example.com',
                educationStage: 'junior_high',
                enrollmentYear: 2024,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ password: 'newUserPassword123' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await PATCH(request);

            expect(response.status).toBe(200);
            const updateCall = mocks.mockPrismaUser.update.mock.calls[0][0];
            expect(updateCall.data.password).toBe('hashed_newUserPassword123');
        });
    });

    describe('管理员特有功能', () => {
        it('管理员修改信息时使用的是自己的 session email', async () => {
            const { getServerSession } = await import('next-auth');
            vi.mocked(getServerSession).mockResolvedValue({
                user: {
                    email: 'admin@localhost',
                    name: 'Admin',
                    role: 'admin',
                },
                expires: '2025-12-31',
            });

            const updatedUser = {
                name: 'Admin Updated',
                email: 'admin@localhost',
                educationStage: 'junior_high',
                enrollmentYear: 2025,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'Admin Updated' }),
                headers: { 'Content-Type': 'application/json' },
            });

            await PATCH(request);

            // 验证更新操作使用了 session 中的 email
            const updateCall = mocks.mockPrismaUser.update.mock.calls[0][0];
            expect(updateCall.where.email).toBe('admin@localhost');
        });

        it('普通用户修改信息时使用的是自己的 session email', async () => {
            const { getServerSession } = await import('next-auth');
            vi.mocked(getServerSession).mockResolvedValue({
                user: {
                    email: 'normaluser@example.com',
                    name: 'Normal User',
                    role: 'user',
                },
                expires: '2025-12-31',
            });

            const updatedUser = {
                name: 'Normal Updated',
                email: 'normaluser@example.com',
                educationStage: 'primary',
                enrollmentYear: 2023,
            };
            mocks.mockPrismaUser.update.mockResolvedValue(updatedUser);

            const request = new Request('http://localhost/api/user', {
                method: 'PATCH',
                body: JSON.stringify({ name: 'Normal Updated' }),
                headers: { 'Content-Type': 'application/json' },
            });

            await PATCH(request);

            // 验证更新操作使用了 session 中的 email（不能修改其他用户）
            const updateCall = mocks.mockPrismaUser.update.mock.calls[0][0];
            expect(updateCall.where.email).toBe('normaluser@example.com');
        });
    });
});

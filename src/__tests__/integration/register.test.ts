/**
 * /api/register API 集成测试
 * 测试用户注册接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockPrismaUser: {
        findUnique: vi.fn(),
        create: vi.fn(),
        // 注册状态接口同时返回是否已有管理员
        count: vi.fn(() => Promise.resolve(1)),
    },
    mockGetAppConfig: vi.fn(() => ({
        aiProvider: 'gemini',
        allowRegistration: true,
    })) as ReturnType<typeof vi.fn>,
}));

// Mock Prisma client
vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: mocks.mockPrismaUser,
    },
}));

// Mock config
vi.mock('@/lib/config', () => ({
    getAppConfig: mocks.mockGetAppConfig,
}));

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
    hash: vi.fn((password: string) => Promise.resolve(`hashed_${password}`)),
}));

// Import after mocks
import { POST } from '@/app/api/register/route';
import { GET as GET_STATUS } from '@/app/api/register/status/route';
import { registerIpLimiter } from '@/lib/rate-limit';

describe('/api/register', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerIpLimiter.reset('unknown');
        registerIpLimiter.reset('5.5.5.5');
        // Reset config mock to allow registration by default
        mocks.mockGetAppConfig.mockReturnValue({
            aiProvider: 'gemini',
            allowRegistration: true,
        });
    });

    describe('POST /api/register', () => {
        const validUserData = {
            email: 'newuser@example.com',
            password: 'password123',
            name: 'New User',
            educationStage: 'junior_high',
            enrollmentYear: 2024,
        };

        it('同一 IP 每小时注册超过 10 次时返回 429', async () => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue({ id: 'exists' });
            const send = () => POST(new Request('http://localhost/api/register', {
                method: 'POST',
                headers: { 'x-real-ip': '5.5.5.5' },
                body: JSON.stringify(validUserData),
            }));
            for (let i = 0; i < 10; i++) {
                expect((await send()).status).toBe(409);
            }

            const response = await send();
            expect(response.status).toBe(429);
            expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
            await expect(response.json()).resolves.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
        });

        it('应该成功注册新用户', async () => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue(null); // 用户不存在
            mocks.mockPrismaUser.create.mockResolvedValue({
                id: 'new-user-id',
                ...validUserData,
                password: 'hashed_password123',
            });

            const request = new Request('http://localhost/api/register', {
                method: 'POST',
                body: JSON.stringify(validUserData),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(201);
            expect(data.user).toBeDefined();
            expect(data.user.email).toBe('newuser@example.com');
            expect(data.message).toBe('User created successfully');
        });

        it('应该拒绝已存在的邮箱', async () => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue({
                id: 'existing-user-id',
                email: 'newuser@example.com',
            });

            const request = new Request('http://localhost/api/register', {
                method: 'POST',
                body: JSON.stringify(validUserData),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(409);
            expect(data.message).toBe('User with this email already exists');
        });

        it('应该接受 user@localhost 邮箱格式', async () => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue(null);
            mocks.mockPrismaUser.create.mockResolvedValue({
                id: 'new-user-id',
                email: 'user@localhost',
                password: 'hashed_password123',
                name: 'Local User',
            });

            const request = new Request('http://localhost/api/register', {
                method: 'POST',
                body: JSON.stringify({
                    ...validUserData,
                    email: 'user@localhost',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(201);
            expect(data.user.email).toBe('user@localhost');
        });

        it('应该拒绝无效邮箱格式', async () => {
            const request = new Request('http://localhost/api/register', {
                method: 'POST',
                body: JSON.stringify({
                    ...validUserData,
                    email: 'invalid-email',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(500); // Zod validation error caught as 500
        });

        it('应该拒绝太短的密码', async () => {
            const request = new Request('http://localhost/api/register', {
                method: 'POST',
                body: JSON.stringify({
                    ...validUserData,
                    password: '123',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(500); // Zod validation error
        });

        it('应该拒绝空用户名', async () => {
            const request = new Request('http://localhost/api/register', {
                method: 'POST',
                body: JSON.stringify({
                    ...validUserData,
                    name: '',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(500); // Zod validation error
        });

        it('配置中未指定注册开关时按关闭处理，返回 403', async () => {
            mocks.mockGetAppConfig.mockReturnValue({ aiProvider: 'gemini' });

            const response = await POST(new Request('http://localhost/api/register', {
                method: 'POST',
                body: JSON.stringify(validUserData),
                headers: { 'Content-Type': 'application/json' },
            }));

            expect(response.status).toBe(403);
        });

        it('应该在注册禁用时返回 403', async () => {
            // 重新 mock getAppConfig
            mocks.mockGetAppConfig.mockReturnValue({
                aiProvider: 'gemini',
                allowRegistration: false,
            });

            const request = new Request('http://localhost/api/register', {
                method: 'POST',
                body: JSON.stringify(validUserData),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(403);
            expect(data.message).toBe('Registration is currently disabled');
        });

        it('返回的用户数据不应包含密码', async () => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue(null);
            mocks.mockPrismaUser.create.mockResolvedValue({
                id: 'new-user-id',
                email: validUserData.email,
                password: 'hashed_password123',
                name: validUserData.name,
            });

            const request = new Request('http://localhost/api/register', {
                method: 'POST',
                body: JSON.stringify(validUserData),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(201);
            expect(data.user).not.toHaveProperty('password');
        });
    });

    describe('GET /api/register/status (注册状态查询)', () => {
        it('应该返回允许注册状态', async () => {
            mocks.mockGetAppConfig.mockReturnValue({
                aiProvider: 'gemini',
                allowRegistration: true,
            });

            const response = await GET_STATUS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.allowRegistration).toBe(true);
        });

        it('应该返回禁止注册状态', async () => {
            mocks.mockGetAppConfig.mockReturnValue({
                aiProvider: 'gemini',
                allowRegistration: false,
            });

            const response = await GET_STATUS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.allowRegistration).toBe(false);
        });

        it('配置中未指定时按关闭处理', async () => {
            mocks.mockGetAppConfig.mockReturnValue({
                aiProvider: 'gemini',
                // 没有 allowRegistration 字段
            });

            const response = await GET_STATUS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.allowRegistration).toBe(false);
        });
    });
});

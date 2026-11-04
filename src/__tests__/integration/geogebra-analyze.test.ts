/**
 * /api/geogebra-analyze API 集成测试
 * 测试 GeoGebra 分析接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockPrismaUser: {
        findUnique: vi.fn(),
    },
    mockAIService: {
        analyzeForGeogebra: vi.fn(),
    },
    mockSession: {
        user: {
            email: 'user@example.com',
            name: 'Test User',
            id: 'u1',
        },
        expires: '2025-12-31',
    },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: mocks.mockPrismaUser,
    },
}));

vi.mock('@/lib/ai', () => ({
    getAIService: vi.fn(() => mocks.mockAIService),
}));

vi.mock('next-auth', () => ({
    getServerSession: vi.fn(() => Promise.resolve(mocks.mockSession)),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

import { POST } from '@/app/api/geogebra-analyze/route';

describe('/api/geogebra-analyze', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockPrismaUser.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
    });

    describe('POST /api/geogebra-analyze', () => {
        it('缺少 questionText 时返回 400', async () => {
            const request = new Request('http://localhost/api/geogebra-analyze', {
                method: 'POST',
                body: JSON.stringify({
                    answerText: 'x = 1',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.suitable).toBe(false);
            expect(data.description).toBe('题目文本为空');
        });

        it('questionText 为空字符串时返回 400', async () => {
            const request = new Request('http://localhost/api/geogebra-analyze', {
                method: 'POST',
                body: JSON.stringify({
                    questionText: '',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.suitable).toBe(false);
        });

        it('成功分析并返回 GeoGebra 命令', async () => {
            mocks.mockPrismaUser.findUnique.mockResolvedValue({ id: 'u1', role: 'user' });
            mocks.mockAIService.analyzeForGeogebra.mockResolvedValue({
                suitable: true,
                commands: ['Line((0,0),(1,1))'],
                description: 'OK',
            });

            const request = new Request('http://localhost/api/geogebra-analyze', {
                method: 'POST',
                body: JSON.stringify({
                    questionText: 'y = x',
                    answerText: 'x = 1',
                    analysis: '直线',
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.suitable).toBe(true);
            expect(data.commands).toEqual(['Line((0,0),(1,1))']);
        });
    });
});

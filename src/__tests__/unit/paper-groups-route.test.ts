/**
 * /api/paper-groups 的创建冲突：并发窗口内撞唯一约束时返回业务错误，而不是 500。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    userFindUnique: vi.fn(),
    groupFindFirst: vi.fn(),
    groupAggregate: vi.fn(),
    groupCreate: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/eula/server', () => ({ isEulaPending: () => false }));
vi.mock('@/lib/db-write-queue', () => ({ serializeWrite: (operation: () => Promise<unknown>) => operation() }));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: { findUnique: mocks.userFindUnique },
        paperGroup: {
            findFirst: mocks.groupFindFirst,
            aggregate: mocks.groupAggregate,
            create: mocks.groupCreate,
        },
    },
}));

import { POST } from '@/app/api/paper-groups/route';

const session = { user: { id: 'u1', email: 'user@example.com', role: 'user' }, expires: '2099-01-01' };
const user = { id: 'u1', email: 'user@example.com', name: 'User', role: 'user' };
const post = (body: unknown) => POST(new Request('http://localhost/api/paper-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
}));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(session);
    mocks.userFindUnique.mockResolvedValue(user);
    mocks.groupFindFirst.mockResolvedValue(null);
    mocks.groupAggregate.mockResolvedValue({ _max: { order: -1 } });
});

describe('POST /api/paper-groups', () => {
    it('并发创建同名分组撞 P2002 时返回 400 重名错误', async () => {
        mocks.groupCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

        const response = await post({ name: '数学' });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.message).toBe('Group name already exists');
        expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('创建成功返回分组', async () => {
        mocks.groupCreate.mockResolvedValue({ id: 'g1', name: '数学', order: 0 });

        const response = await post({ name: '数学' });

        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({ id: 'g1', name: '数学' });
    });
});

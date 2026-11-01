import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getDefaultPaperLevelGroupId, ensureDefaultPaperGroups } from '@/lib/paper-level';

const mocks = vi.hoisted(() => ({
    mockPrisma: {
        paperGroup: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
            create: vi.fn(),
        },
    },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: mocks.mockPrisma,
}));

const mockPrisma = mocks.mockPrisma;

describe('星级对应的默认卷别分组', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([[1, 'a'], [2, 'a'], [3, 'a'], [4, 'b'], [5, 'b']] as const)('%i 星默认归入 key=%s 的分组', async (stars, key) => {
        mockPrisma.paperGroup.findFirst.mockResolvedValue({ id: `group-${key}` });
        const result = await getDefaultPaperLevelGroupId('user-1', stars);
        expect(result).toBe(`group-${key}`);
        expect(mockPrisma.paperGroup.findFirst).toHaveBeenCalledWith({
            where: { userId: 'user-1', key, isActive: true },
            select: { id: true },
        });
    });

    it.each([null, undefined, 0, 6, 2.5, NaN])('未评级或无效星级 %s 不自动分类', async (stars) => {
        const result = await getDefaultPaperLevelGroupId('user-1', stars);
        expect(result).toBeNull();
        expect(mockPrisma.paperGroup.findFirst).not.toHaveBeenCalled();
    });

    it('默认分组不存在时返回 null', async () => {
        mockPrisma.paperGroup.findFirst.mockResolvedValue(null);
        const result = await getDefaultPaperLevelGroupId('user-1', 3);
        expect(result).toBeNull();
    });
});

describe('ensureDefaultPaperGroups', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('已有全部分组时不创建', async () => {
        mockPrisma.paperGroup.findMany.mockResolvedValue([
            { id: 'ga', key: 'a' },
            { id: 'gb', key: 'b' },
            { id: 'go', key: 'other' },
        ]);
        const map = await ensureDefaultPaperGroups('user-1');
        expect(map).toEqual({ a: 'ga', b: 'gb', other: 'go' });
        expect(mockPrisma.paperGroup.create).not.toHaveBeenCalled();
    });

    it('缺少分组时自动创建', async () => {
        mockPrisma.paperGroup.findMany.mockResolvedValue([{ id: 'ga', key: 'a' }]);
        mockPrisma.paperGroup.create
            .mockResolvedValueOnce({ id: 'gb' })
            .mockResolvedValueOnce({ id: 'go' });
        const map = await ensureDefaultPaperGroups('user-1');
        expect(map).toEqual({ a: 'ga', b: 'gb', other: 'go' });
        expect(mockPrisma.paperGroup.create).toHaveBeenCalledTimes(2);
    });
});

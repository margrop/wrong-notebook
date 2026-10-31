/**
 * 按年级学期找到系统标签的年级根节点，用于把新标签挂到正确的年级下
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { findParentTagIdForGrade } from '@/lib/tag-recognition';

const roots = ['一年级上', '一年级下', '七年级上', '七年级下', '高一上', '高二下', '高三'].map((name) => ({ id: `id-${name}`, name }));
const findMany = vi.fn();
const client = { knowledgeTag: { findMany } } as unknown as Prisma.TransactionClient;
const find = (grade: string | null | undefined) => findParentTagIdForGrade(grade, 'math', client);

describe('findParentTagIdForGrade', () => {
    beforeEach(() => {
        findMany.mockReset();
        findMany.mockResolvedValue(roots);
    });

    it('缺少年级或学科时不查询数据库', async () => {
        expect(await find(null)).toBeNull();
        expect(await findParentTagIdForGrade('七年级上', '', client)).toBeNull();
        expect(findMany).not.toHaveBeenCalled();
    });

    it('只查询该学科的系统年级根节点', async () => {
        await find('七年级上');
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { subject: 'math', isSystem: true, parentId: null },
        }));
    });

    it('名称完全一致时直接命中', async () => {
        expect(await find(' 七年级上 ')).toBe('id-七年级上');
    });

    it('把初一、初二等别名换算成七、八年级，并识别上下学期', async () => {
        expect(await find('初一，上期')).toBe('id-七年级上');
        expect(await find('初一，下期')).toBe('id-七年级下');
        expect(await find('高二，下期')).toBe('id-高二下');
    });

    it('识别英文写法；Grade 10～12 不会被误判为一年级', async () => {
        expect(await find('Grade 1, 2nd Semester')).toBe('id-一年级下');
        expect(await find('Grade 7, 1st Semester')).toBe('id-七年级上');
        expect(await find('Grade 10, 1st Semester')).toBe('id-高一上');
        expect(await find('Grade 11, Second Semester')).toBe('id-高二下');
        expect(await find('Grade 12')).toBe('id-高三');
    });

    it('没有学期区分的年级回退到年级本身', async () => {
        expect(await find('高三，上期')).toBe('id-高三');
    });

    it('识别不出年级或没有对应节点时返回 null', async () => {
        expect(await find('大学')).toBeNull();
        expect(await find('八年级上')).toBeNull();
        findMany.mockResolvedValue([]);
        expect(await find('七年级上')).toBeNull();
    });
});

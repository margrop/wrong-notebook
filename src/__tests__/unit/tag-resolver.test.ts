/**
 * 按名称在错题本标签体系内查找或创建知识点标签
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

vi.mock('@/lib/tags/tag-recognition', () => ({ findParentTagIdForGrade: vi.fn() }));

import { findParentTagIdForGrade } from '@/lib/tags/tag-recognition';
import { resolveOrCreateTags, inferTagScope } from '@/lib/tags/tag-resolver';

const findParentTagIdForGradeMock = vi.mocked(findParentTagIdForGrade);

const findFirst = vi.fn();
const create = vi.fn();
const client = { knowledgeTag: { findFirst, create } } as unknown as Prisma.TransactionClient;

const input = {
    userId: 'user-1',
    tagNames: ['一元二次方程'],
    subjectKey: 'math',
    tagSet: 'default',
    gradeSemester: '七年级上',
};

describe('resolveOrCreateTags', () => {
    beforeEach(() => {
        findFirst.mockReset();
        create.mockReset();
        findParentTagIdForGradeMock.mockReset();
    });

    it('命中系统标签时直接复用，不创建新标签', async () => {
        findFirst.mockResolvedValue({ id: 'tag-sys-1', isSystem: true });
        const result = await resolveOrCreateTags(client, input);
        expect(result).toEqual([{ id: 'tag-sys-1' }]);
        expect(create).not.toHaveBeenCalled();
        expect(findParentTagIdForGradeMock).not.toHaveBeenCalled();
    });

    it('命中本人标签时直接复用，不创建新标签', async () => {
        findFirst.mockResolvedValue({ id: 'tag-user-1', isSystem: false });
        const result = await resolveOrCreateTags(client, input);
        expect(result).toEqual([{ id: 'tag-user-1' }]);
        expect(create).not.toHaveBeenCalled();
        expect(findParentTagIdForGradeMock).not.toHaveBeenCalled();
    });

    it('只在指定的 tagSet 内匹配', async () => {
        findFirst.mockResolvedValue(null);
        findParentTagIdForGradeMock.mockResolvedValue(null);
        create.mockResolvedValue({ id: 'tag-new-1' });
        await resolveOrCreateTags(client, { ...input, tagSet: 'custom-set' });
        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tagSet: 'custom-set' }),
        }));
        expect(findParentTagIdForGradeMock).toHaveBeenCalledWith('七年级上', 'math', client, 'custom-set');
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ tagSet: 'custom-set' }),
        }));
    });

    it('新建标签挂到 findParentTagIdForGrade 返回的父节点下', async () => {
        findFirst.mockResolvedValue(null);
        findParentTagIdForGradeMock.mockResolvedValue('parent-grade-1');
        create.mockResolvedValue({ id: 'tag-new-1' });
        const result = await resolveOrCreateTags(client, input);
        expect(findParentTagIdForGradeMock).toHaveBeenCalledWith('七年级上', 'math', client, 'default');
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                name: '一元二次方程',
                subject: 'math',
                isSystem: false,
                userId: 'user-1',
                parentId: 'parent-grade-1',
                tagSet: 'default',
            }),
        }));
        expect(result).toEqual([{ id: 'tag-new-1' }]);
    });

    it('没有年级时 parentId 为 null，与原实现一致', async () => {
        findFirst.mockResolvedValue(null);
        findParentTagIdForGradeMock.mockResolvedValue(null);
        create.mockResolvedValue({ id: 'tag-new-2' });
        await resolveOrCreateTags(client, { ...input, gradeSemester: null });
        expect(findParentTagIdForGradeMock).toHaveBeenCalledWith(null, 'math', client, 'default');
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ parentId: null }),
        }));
    });

    it('重复名称只处理一次，保持首次出现顺序', async () => {
        findFirst
            .mockResolvedValueOnce({ id: 'tag-a', isSystem: true })
            .mockResolvedValueOnce({ id: 'tag-b', isSystem: true });
        const result = await resolveOrCreateTags(client, {
            ...input,
            tagNames: ['标签A', '标签B', '标签A', '标签B', '标签A'],
        });
        expect(result).toEqual([{ id: 'tag-a' }, { id: 'tag-b' }]);
        expect(findFirst).toHaveBeenCalledTimes(2);
        expect(create).not.toHaveBeenCalled();
    });

    it('空字符串与纯空白名称跳过，不查询也不创建', async () => {
        findFirst.mockResolvedValue({ id: 'tag-a', isSystem: true });
        const result = await resolveOrCreateTags(client, {
            ...input,
            tagNames: ['', '   ', '标签A'],
        });
        expect(result).toEqual([{ id: 'tag-a' }]);
        expect(findFirst).toHaveBeenCalledTimes(1);
        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ name: '标签A' }),
        }));
        expect(create).not.toHaveBeenCalled();
    });
});

describe('inferTagScope', () => {
    it('优先使用错题本创建时保存的 subjectKey，不受改名影响', () => {
        expect(inferTagScope({ name: '我的错题本', tagSet: 'cnm', subjectKey: 'physics' }))
            .toEqual({ subjectKey: 'physics', tagSet: 'cnm' });
    });

    it('旧错题本没有 subjectKey 时按名称推断', () => {
        expect(inferTagScope({ name: '初二数学', tagSet: null, subjectKey: null }))
            .toEqual({ subjectKey: 'math', tagSet: 'default' });
    });

    it('无法推断或没有错题本时回退为 other / default', () => {
        expect(inferTagScope({ name: '综合', tagSet: null })).toEqual({ subjectKey: 'other', tagSet: 'default' });
        expect(inferTagScope(null)).toEqual({ subjectKey: 'other', tagSet: 'default' });
    });
});

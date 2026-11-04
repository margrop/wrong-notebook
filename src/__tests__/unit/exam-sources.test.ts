/**
 * 组卷选题来源注册表单元测试
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn() }));

import { DEFAULT_EXAM_SOURCE, getExamSourceProvider, registerExamSourceProvider, unregisterExamSourceProvider } from '@/lib/exam/exam-sources';
import { selectSourceItems } from '@/lib/exam/exam';

describe('exam-sources 注册表', () => {
    it('默认注册了 error-items provider，即现有 selectSourceItems 逻辑', () => {
        const provider = getExamSourceProvider(DEFAULT_EXAM_SOURCE);
        expect(provider).toBeDefined();
        expect(provider?.key).toBe(DEFAULT_EXAM_SOURCE);
        expect(provider?.select).toBe(selectSourceItems);
    });

    it('未注册的 key 返回 undefined', () => {
        expect(getExamSourceProvider('nonexistent')).toBeUndefined();
    });

    it('注册后可获取，注销后消失', async () => {
        const testProvider = {
            key: 'test-source',
            select: async () => [],
        };
        registerExamSourceProvider(testProvider);
        expect(getExamSourceProvider('test-source')).toBe(testProvider);

        unregisterExamSourceProvider('test-source');
        expect(getExamSourceProvider('test-source')).toBeUndefined();
    });
});

/**
 * 短 ID 生成与校验单元测试
 */
import { describe, it, expect, vi } from 'vitest';
import { BASE58_ALPHABET, generateShortId, generateUniqueShortId, isShortId } from '@/lib/short-id/short-id';

describe('short-id', () => {
    it('生成的 ID 为 6 位 base58 字符', () => {
        for (let i = 0; i < 200; i++) {
            const id = generateShortId();
            expect(id).toHaveLength(6);
            expect([...id].every((char) => BASE58_ALPHABET.includes(char))).toBe(true);
        }
    });

    it('base58 字母表不包含易混淆字符', () => {
        for (const char of ['0', 'O', 'I', 'l']) {
            expect(BASE58_ALPHABET).not.toContain(char);
        }
        expect(BASE58_ALPHABET).toHaveLength(58);
    });

    it('isShortId 只接受 6 位 base58 字符串', () => {
        expect(isShortId('aB3xYz')).toBe(true);
        expect(isShortId('aB3xY')).toBe(false);
        expect(isShortId('aB3xYzz')).toBe(false);
        expect(isShortId('aB0xYz')).toBe(false);
        expect(isShortId('数学题目一二')).toBe(false);
        expect(isShortId(null)).toBe(false);
    });

    it('遇到已占用的 ID 时重新生成', async () => {
        const findUnique = vi.fn()
            .mockResolvedValueOnce({ id: 'taken' })
            .mockResolvedValueOnce(null);

        const id = await generateUniqueShortId({ errorItem: { findUnique } });

        expect(isShortId(id)).toBe(true);
        expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it('多次冲突后放弃并报错', async () => {
        const findUnique = vi.fn().mockResolvedValue({ id: 'taken' });

        await expect(generateUniqueShortId({ errorItem: { findUnique } })).rejects.toThrow();
    });
});

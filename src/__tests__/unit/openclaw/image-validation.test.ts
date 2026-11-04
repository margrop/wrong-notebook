import { describe, it, expect } from 'vitest';
import { validateImage } from '@/lib/openclaw/image-validation';

const VALID_BASE64 = 'dGVzdA=='; // "test"，远小于 5MB

describe('validateImage', () => {
    it('接受合法的 JPG 图片', () => {
        expect(validateImage(VALID_BASE64, 'photo.jpg', 'image/jpeg')).toEqual({ valid: true });
    });

    it('接受合法的 PNG 图片', () => {
        expect(validateImage(VALID_BASE64, 'photo.png', 'image/png')).toEqual({ valid: true });
    });

    it('接受 .jpeg 扩展名', () => {
        expect(validateImage(VALID_BASE64, 'photo.jpeg', 'image/jpeg')).toEqual({ valid: true });
    });

    it('拒绝空的 base64 数据', () => {
        const result = validateImage('', 'photo.jpg', 'image/jpeg');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('图片数据为空');
    });

    it('拒绝不支持的扩展名', () => {
        const result = validateImage(VALID_BASE64, 'photo.gif', 'image/gif');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不支持的图片格式');
        expect(result.error).toContain('.gif');
    });

    it('拒绝不支持的 MIME 类型', () => {
        const result = validateImage(VALID_BASE64, 'photo.png', 'image/svg+xml');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不支持的图片类型');
        expect(result.error).toContain('image/svg+xml');
    });

    it('拒绝超过 5MB 的图片', () => {
        // 构造一个估算大小超过 5MB 的 base64：5MB * 4 / 3 ≈ 6.99M 字符
        const largeBase64 = 'A'.repeat(7 * 1024 * 1024);
        const result = validateImage(largeBase64, 'photo.jpg', 'image/jpeg');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('图片大小超过限制');
        expect(result.error).toContain('5MB');
    });

    it('扩展名大小写不敏感', () => {
        expect(validateImage(VALID_BASE64, 'PHOTO.JPG', 'image/jpeg')).toEqual({ valid: true });
    });

    it('MIME 类型精确匹配（image/jpg 不被接受）', () => {
        const result = validateImage(VALID_BASE64, 'photo.jpg', 'image/jpg');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不支持的图片类型');
    });

    it('无扩展名的文件名视为不合法', () => {
        const result = validateImage(VALID_BASE64, 'photo', 'image/jpeg');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('不支持的图片格式');
    });
});

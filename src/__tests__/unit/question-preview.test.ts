import { describe, it, expect } from 'vitest';
import { truncateQuestionPreview } from '@/lib/question/question-preview';

describe('truncateQuestionPreview', () => {
    it('空白与 null 返回 null', () => {
        expect(truncateQuestionPreview(null)).toBeNull();
        expect(truncateQuestionPreview('')).toBeNull();
        expect(truncateQuestionPreview('   ')).toBeNull();
        expect(truncateQuestionPreview('\n\t ')).toBeNull();
    });

    it('短文本不截断', () => {
        expect(truncateQuestionPreview('已知函数 f(x)=x^2')).toBe('已知函数 f(x)=x^2');
    });

    it('合并多余空白与换行', () => {
        expect(truncateQuestionPreview('已知  函数\n\nf(x)=x^2\n求值')).toBe('已知 函数 f(x)=x^2 求值');
    });

    it('超出 60 字符截断并加省略号', () => {
        const text = 'a'.repeat(61);
        const result = truncateQuestionPreview(text);
        expect(result).toBe('a'.repeat(60) + '…');
        expect(result?.length).toBe(61);
    });

    it('恰好 60 字符不截断', () => {
        const text = 'b'.repeat(60);
        expect(truncateQuestionPreview(text)).toBe(text);
    });
});

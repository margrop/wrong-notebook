/**
 * 错题卡片预览：把 Markdown 和 LaTeX 转成可读的纯文本
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));

import { cleanMarkdown } from '@/lib/markdown-utils';

describe('cleanMarkdown', () => {
    it('空内容返回空字符串', () => {
        expect(cleanMarkdown('')).toBe('');
    });

    it('去掉 Markdown 格式', () => {
        expect(cleanMarkdown('**已知** 函数 *f(x)*')).toBe('已知 函数 f(x)');
    });

    it('把分数、根号和常用符号转成文字', () => {
        expect(cleanMarkdown('$\\frac{1}{2} \\times 4 \\div \\sqrt{x} \\pm 1$')).toBe('1/2 × 4 ÷ √x ± 1');
        expect(cleanMarkdown('$\\angle A = 90^\\circ$，$\\triangle ABC$')).toBe('∠ A = 90^°，△ ABC');
    });

    it('\\leq、\\geq 与 \\le、\\ge 都转成不等号，不残留字母', () => {
        expect(cleanMarkdown('$x \\leq 3$ 且 $y \\geq 2$')).toBe('x ≤ 3 且 y ≥ 2');
        expect(cleanMarkdown('$x \\le 3$ 且 $y \\ge 2$')).toBe('x ≤ 3 且 y ≥ 2');
        expect(cleanMarkdown('$a \\neq b$')).toBe('a ≠ b');
    });

    it('保留 \\text{} 中的文字，如单位', () => {
        expect(cleanMarkdown('$5\\text{cm} + 3\\mbox{米}$')).toBe('5cm + 3米');
    });

    it('去掉 \\left、\\right 和环境命令', () => {
        expect(cleanMarkdown('$\\left(x\\right)$')).toBe('(x)');
        expect(cleanMarkdown('$\\begin{cases}x\\end{cases}$')).toBe('x');
    });

    it('转义的下划线还原为下划线', () => {
        expect(cleanMarkdown('填空：\\_\\_\\_')).toBe('填空：___');
    });
});

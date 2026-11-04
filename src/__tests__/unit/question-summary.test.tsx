/**
 * 错题卡片题干摘要：文字去掉 Markdown 格式，公式交给 KaTeX 渲染
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));

import { QuestionSummary } from '@/components/error-list/question-summary';
import { buildQuestionSummary } from '@/lib/question/question-summary';

describe('buildQuestionSummary', () => {
    it('空内容返回空数组', () => {
        expect(buildQuestionSummary('', 80)).toEqual([]);
        expect(buildQuestionSummary(null, 80)).toEqual([]);
    });

    it('拆分文字与公式，并去掉 Markdown 格式', () => {
        expect(buildQuestionSummary('**已知** $\\frac{\\sqrt{3}}{2}$，求 $\\sin\\alpha$ 的值', 80)).toEqual([
            { type: 'text', value: '已知 ' },
            { type: 'math', tex: '\\frac{\\sqrt{3}}{2}' },
            { type: 'text', value: '，求 ' },
            { type: 'math', tex: '\\sin\\alpha' },
            { type: 'text', value: ' 的值' },
        ]);
    });

    it('统一 \\(…\\)、$$…$$ 定界符，且块公式内的空行不会被当作分段', () => {
        expect(buildQuestionSummary('计算 \\(a+b\\)：$$x=\n\n1$$\n\n第二段', 80)).toEqual([
            { type: 'text', value: '计算 ' },
            { type: 'math', tex: 'a+b' },
            { type: 'text', value: '：' },
            { type: 'math', tex: 'x=\n\n1' },
        ]);
    });

    it('只取第一段', () => {
        expect(buildQuestionSummary('第一段\n\n第二段', 80)).toEqual([{ type: 'text', value: '第一段' }]);
    });

    it('超长时截断文字并加省略号，公式不会被截断到一半', () => {
        expect(buildQuestionSummary('一二三四五六', 4)).toEqual([{ type: 'text', value: '一二三四...' }]);
        expect(buildQuestionSummary('一二三 $\\frac{1}{2}$ 四五', 4)).toEqual([
            { type: 'text', value: '一二三...' },
        ]);
        expect(buildQuestionSummary('$\\frac{1}{2}$ 一二三四五', 4)).toEqual([
            { type: 'math', tex: '\\frac{1}{2}' },
            { type: 'text', value: '...' },
        ]);
    });
});

/** 渲染摘要，返回 HTML 与去掉标签后的可见文字（不含 KaTeX 隐藏的 MathML 源码） */
function renderSummary(text: string) {
    const html = renderToStaticMarkup(<QuestionSummary text={text} maxLength={80} />);
    // 在惰性文档中读取文字，避免将不完整的正则标签删除当作 HTML 解析。
    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll('.katex-mathml').forEach((node) => node.remove());
    const visible = document.body.textContent ?? '';
    return { html, visible };
}

describe('QuestionSummary', () => {
    it('用 KaTeX 渲染公式，不显示 LaTeX 源码', () => {
        const { html, visible } = renderSummary('已知 $\\vec{a}=\\frac{1}{2}$');
        expect(html).toContain('class="katex"');
        expect(visible).toContain('已知');
        expect(visible).not.toContain('\\');
    });

    it('恶意标签及嵌套标签仍作为文本处理，不创建可执行元素', () => {
        for (const text of ['题干 <script>globalThis.injected = true</script>',
            '题干 <img src=x onerror=alert(1)>', '题干 <scr<script>ipt>alert(1)</scr<script>ipt>']) {
            const { html } = renderSummary(text);
            const parsed = new DOMParser().parseFromString(html, 'text/html');
            expect(parsed.querySelector('script, img')).toBeNull();
            expect(parsed.body.textContent).toContain('题干');
        }
    });

    it('公式无法解析时退回纯文本', () => {
        const { html, visible } = renderSummary('错误 $\\frac{1}{2$');
        expect(html).not.toContain('class="katex"');
        expect(visible).toContain('错误');
        expect(visible).not.toContain('$');
    });

    it('未闭合的 $ 或缺少定界符的 LaTeX 片段按纯文本清理，不残留反斜杠和 $', () => {
        for (const text of ['已知 $x \\leq 3', '已知 \\frac{1}{2} \\times 4']) {
            const { visible } = renderSummary(text);
            expect(visible).not.toMatch(/[\\$]/);
        }
    });
});

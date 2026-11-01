import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '@/components/markdown-renderer';

describe('旧题缺少答案或解析时的详情渲染', () => {
    it.each([null, undefined, ''])('内容为 %s 时能正常显示空区域', (content) => {
        expect(() => renderToStaticMarkup(<MarkdownRenderer content={content} />)).not.toThrow();
    });
});

/** 渲染结果中 KaTeX 公式的个数 */
function countFormulas(content: string): number {
    return (renderToStaticMarkup(<MarkdownRenderer content={content} />).match(/class="katex"/g) || []).length;
}

/** 公式对应的 LaTeX 源码（KaTeX 保存在 annotation 中） */
function annotations(content: string): string[] {
    const html = renderToStaticMarkup(<MarkdownRenderer content={content} />);
    return [...html.matchAll(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g)].map((m) => m[1]);
}

describe('LaTeX 公式渲染', () => {
    it('渲染 $…$ 和 $$…$$，公式紧贴中文时也能识别', () => {
        expect(countFormulas('求 $\\frac{1}{2}$ 的值')).toBe(1);
        expect(countFormulas('面积为$S=6$平方厘米')).toBe(1);
        expect(countFormulas('答案：\n\n$$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$')).toBe(1);
    });

    it('渲染 \\(…\\) 和 \\[…\\] 定界符', () => {
        expect(annotations('求 \\(\\frac{1}{2}\\) 的值')).toEqual(['\\frac{1}{2}']);
        expect(annotations('解：\\[x = \\frac{1}{2}\\]')).toEqual(['x = \\frac{1}{2}']);
    });

    it('不把 \\neq、\\nabla 中的 \\n 当作换行，公式外字面的 \\n 仍转为换行', () => {
        expect(annotations('因为 $a \\neq b$，且 $\\nabla f$')).toEqual(['a \\neq b', '\\nabla f']);
        expect(renderToStaticMarkup(<MarkdownRenderer content={'第一步。\\n第二步'} />)).toMatch(/第一步。<\/p>\s*<p[^>]*>第二步/);
    });

    it('多行 $$ 块内的标点和换行不被拆成段落', () => {
        const content = '解方程组：\n$$\n\\begin{cases}\nx+y=1;\\\\\nx-y=3.\n\\end{cases}\n$$\n得解。';
        expect(countFormulas(content)).toBe(1);
        expect(annotations(content)[0]).toContain('x+y=1;\\\\\nx-y=3.');
    });

    it('还原公式内被二次转义的命令，保留换行符 \\\\', () => {
        expect(annotations('$\\\\frac{1}{2}$')).toEqual(['\\frac{1}{2}']);
        expect(annotations('$\\begin{cases}a\\\\\\end{cases}$')).toEqual(['\\begin{cases}a\\\\\\end{cases}']);
    });
});

// 原 /latex-test 调试页中的典型答案格式
describe('常见答案格式的公式渲染', () => {
    it.each([
        ['行内公式', '(1) $a = -12$, $b = 8$, $c = 16$ (2) $t = 12$ (3) $M = \\frac{72}{11}$', 5],
        ['独立公式', '答案:\n\n$$M = \\frac{72}{11}$$', 1],
        ['行内与段落混合', '解:\n\n(1) $a = -12, b = 8, c = 16$\n\n(2) 当 $t = 12$ 时\n\n(3) $M = \\frac{72}{11}$', 3],
        ['行内与独立公式混合', '二次函数: $y = ax^2 + bx + c$\n\n求根公式: $$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$', 2],
    ])('%s', (_name, content, count) => {
        expect(countFormulas(content)).toBe(count);
    });
});

describe('代码渲染', () => {
    it('行内代码保持在段落中，不使用代码块样式', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={'行内 `x + 1` 代码'} />);
        expect(html).toMatch(/<p[^>]*>行内 <code class="bg-muted px-1.5[^"]*">x \+ 1<\/code> 代码<\/p>/);
        expect(html).not.toContain('<code class="block');
    });

    it('代码块由 pre 提供块级样式', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={'```\nblock\n```'} />);
        expect(html).toMatch(/<pre class="bg-muted p-4[^"]*"><code[^>]*>block\n<\/code><\/pre>/);
    });

    it('加粗与行内代码继承外层文字颜色，不在深色系统下的白底打印区变成浅色字', () => {
        const html = renderToStaticMarkup(<MarkdownRenderer content={'**重点**与`代码`'} />);
        expect(html).toContain('<strong class="font-bold">重点</strong>');
        expect(html).not.toContain('text-foreground');
    });

    it('选择题选项自动另起一行，不紧接在题干后面', () => {
        const inlineHtml = renderToStaticMarkup(
            <MarkdownRenderer content={'计算 $2+3$ 的值（ ） A. 4  B. 5  C. 6  D. 7'} />,
        );
        expect(inlineHtml).toMatch(/的值（ ）<\/p>\s*<p[^>]*>A\. 4/);

        const noSpaceHtml = renderToStaticMarkup(
            <MarkdownRenderer content={'下列正确的是（ ）A．1 B．2 C．3 D．4'} />,
        );
        expect(noSpaceHtml).toMatch(/正确的是（ ）<\/p>\s*<p[^>]*>A．1/);

        const newlineHtml = renderToStaticMarkup(
            <MarkdownRenderer content={'下列哪个数是质数？（ ）\nA. 4\nB. 6\nC. 7\nD. 9'} />,
        );
        expect(newlineHtml).toMatch(/是质数？（ ）<\/p>\s*<p[^>]*>A\. 4<\/p>\s*<p[^>]*>B\. 6/);

        // 非选择题中的几何点名 A、B、C 不被错误断行
        const geometryHtml = renderToStaticMarkup(
            <MarkdownRenderer content={'已知 A、B、C 三点共线，求证：AB+BC=AC。'} />,
        );
        expect(geometryHtml).toMatch(/<p[^>]*>已知 A、B、C 三点共线，求证：AB\+BC=AC。<\/p>/);
    });
});

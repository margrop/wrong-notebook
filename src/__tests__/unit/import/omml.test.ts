/**
 * OMML 转 LaTeX 单元测试。
 * 用手写最小 OMML 片段经 DOMParser 解析后喂给 ommlToLatex。
 */
import { describe, expect, it } from "vitest";
import { ommlToLatex } from "@/lib/import/file-parsers/docx/omml";

const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

/** 把 OMML XML 字符串包在 m:oMath 里解析成 Element */
function parseMath(xml: string): Element {
    const doc = new DOMParser().parseFromString(
        `<m:oMath xmlns:m="${M_NS}" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${xml}</m:oMath>`,
        "text/xml"
    );
    const root = doc.documentElement;
    if (root.localName !== "oMath") throw new Error(`解析失败: ${root.localName}`);
    return root;
}

/** 解析 m:oMathPara */
function parseMathPara(xml: string): Element {
    const doc = new DOMParser().parseFromString(
        `<m:oMathPara xmlns:m="${M_NS}" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${xml}</m:oMathPara>`,
        "text/xml"
    );
    return doc.documentElement;
}

/** 简写：m:r/m:t */
function mr(text: string): string {
    return `<m:r><m:t>${text}</m:t></m:r>`;
}

describe("OMML 转 LaTeX：基础结构", () => {
    it("m:r/m:t 普通文字直接输出", () => {
        const { latex, unsupported } = ommlToLatex(parseMath(mr("x+y")));
        expect(latex).toBe("x+y");
        expect(unsupported).toEqual([]);
    });

    it("m:rPr/m:nor 普通文本输出 \\text{}", () => {
        const xml = `<m:r><m:rPr><m:nor/></m:rPr><m:t>面积</m:t></m:r>`;
        const { latex } = ommlToLatex(parseMath(xml));
        expect(latex).toBe("\\text{面积}");
    });

    it("m:f 分数（bar 缺省）", () => {
        const xml = `<m:f><m:num>${mr("a")}</m:num><m:den>${mr("b")}</m:den></m:f>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\frac{a}{b}");
    });

    it("m:f m:type=lin 输出 a/b", () => {
        const xml = `<m:f><m:fPr><m:type m:val="lin"/></m:fPr><m:num>${mr("1")}</m:num><m:den>${mr("2")}</m:den></m:f>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("1/2");
    });

    it("m:f m:type=skw 输出 \\big/", () => {
        const xml = `<m:f><m:fPr><m:type m:val="skw"/></m:fPr><m:num>${mr("a")}</m:num><m:den>${mr("b")}</m:den></m:f>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("a\\big/b");
    });

    it("m:f m:type=noBar 输出 \\atop", () => {
        const xml = `<m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num>${mr("a")}</m:num><m:den>${mr("b")}</m:den></m:f>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("{a \\atop b}");
    });

    it("m:sSup 上标", () => {
        const xml = `<m:sSup><m:e>${mr("x")}</m:e><m:sup>${mr("2")}</m:sup></m:sSup>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("x^2");
    });

    it("m:sSub 下标", () => {
        const xml = `<m:sSub><m:e>${mr("a")}</m:e><m:sub>${mr("n+1")}</m:sub></m:sSub>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("a_{n+1}");
    });

    it("m:sSubSup 上下标", () => {
        const xml = `<m:sSubSup><m:e>${mr("x")}</m:e><m:sub>${mr("n+1")}</m:sub><m:sup>${mr("2")}</m:sup></m:sSubSup>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("x_{n+1}^2");
    });

    it("m:sPre 下标在上标前", () => {
        const xml = `<m:sPre><m:e>${mr("x")}</m:e><m:sub>${mr("i")}</m:sub><m:sup>${mr("n")}</m:sup></m:sPre>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("x_i^{n}");
    });
});

describe("OMML 转 LaTeX：根式、分隔符、n 元运算", () => {
    it("m:rad 无根指数输出 \\sqrt{}", () => {
        const xml = `<m:rad><m:radPr/><m:deg/><m:e>${mr("x")}</m:e></m:rad>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\sqrt{x}");
    });

    it("m:rad m:degHide=1 隐藏根指数", () => {
        const xml = `<m:rad><m:radPr m:degHide="1"/><m:deg>${mr("3")}</m:deg><m:e>${mr("x")}</m:e></m:rad>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\sqrt{x}");
    });

    it("m:rad 带根指数输出 \\sqrt[n]{}", () => {
        const xml = `<m:rad><m:deg>${mr("3")}</m:deg><m:e>${mr("x")}</m:e></m:rad>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\sqrt[3]{x}");
    });

    it("m:d 缺省圆括号", () => {
        const xml = `<m:d><m:e>${mr("x")}</m:e></m:d>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("(x)");
    });

    it("m:d m:begChr/m:endChr 自定义括号", () => {
        const xml = `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>${mr("x")}</m:e></m:d>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("[x]");
    });

    it("m:d 左大括号 + m:eqArr 输出 cases", () => {
        const xml = `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val="}"/></m:dPr><m:e><m:eqArr><m:e>${mr("x+y=1")}</m:e><m:e>${mr("x-y=2")}</m:e></m:eqArr></m:e></m:d>`;
        const { latex } = ommlToLatex(parseMath(xml));
        expect(latex).toContain("\\begin{cases}");
        expect(latex).toContain("\\end{cases}");
        expect(latex).toContain("x+y=1 \\\\ x-y=2");
    });

    it("m:eqArr 单独输出 aligned", () => {
        const xml = `<m:eqArr><m:e>${mr("a=b")}</m:e><m:e>${mr("c=d")}</m:e></m:eqArr>`;
        const { latex } = ommlToLatex(parseMath(xml));
        expect(latex).toContain("\\begin{aligned}");
        expect(latex).toContain("\\end{aligned}");
    });

    it("m:nary 缺省 ∫ 与上下限", () => {
        const xml = `<m:nary><m:naryPr><m:chr m:val="∫"/></m:naryPr><m:sub>${mr("0")}</m:sub><m:sup>${mr("1")}</m:sup><m:e>${mr("x")}</m:e></m:nary>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\int_0^1 x");
    });

    it("m:nary m:chr=∑ 输出 \\sum", () => {
        const xml = `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${mr("i=1")}</m:sub><m:sup>${mr("n")}</m:sup><m:e><m:sSub><m:e>${mr("x")}</m:e><m:sub>${mr("i")}</m:sub></m:sSub></m:e></m:nary>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\sum_{i=1}^n x_i");
    });

    it("m:nary m:subHide=1 隐藏下限", () => {
        const xml = `<m:nary><m:naryPr><m:chr m:val="∑"/><m:subHide m:val="1"/></m:naryPr><m:sub>${mr("i=1")}</m:sub><m:sup>${mr("n")}</m:sup><m:e>${mr("x")}</m:e></m:nary>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\sum^n x");
    });
});

describe("OMML 转 LaTeX：函数与极限", () => {
    it("m:func sin 输出 \\sin", () => {
        const xml = `<m:func><m:fName>${mr("sin")}</m:fName><m:e>${mr("x")}</m:e></m:func>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\sin{x}");
    });

    it("m:func 未知名输出 \\operatorname", () => {
        const xml = `<m:func><m:fName>${mr("sgn")}</m:fName><m:e>${mr("x")}</m:e></m:func>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\operatorname{sgn}{x}");
    });

    it("m:limLow 输出 _{}", () => {
        const xml2 = `<m:limLow><m:e>${mr("lim")}</m:e><m:lim>${mr("x→0")}</m:lim></m:limLow>`;
        const { latex } = ommlToLatex(parseMath(xml2));
        expect(latex).toBe("\\lim_{x\\to0}");
    });

    it("m:limUpp 输出 ^{}", () => {
        const xml = `<m:limUpp><m:e>${mr("lim")}</m:e><m:lim>${mr("n→∞")}</m:lim></m:limUpp>`;
        const { latex } = ommlToLatex(parseMath(xml));
        expect(latex).toBe("\\lim^{n\\to\\infty}");
    });
});

describe("OMML 转 LaTeX：重音、上下划线、组合符号", () => {
    it("m:acc 缺省 hat", () => {
        const xml = `<m:acc><m:e>${mr("x")}</m:e></m:acc>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\hat{x}");
    });

    it("m:acc m:chr=¯ 输出 \\bar", () => {
        const xml = `<m:acc><m:accPr><m:chr m:val="¯"/></m:accPr><m:e>${mr("AB")}</m:e></m:acc>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\bar{AB}");
    });

    it("m:acc m:chr=⃗ 输出 \\vec", () => {
        const xml = `<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr><m:e>${mr("a")}</m:e></m:acc>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\vec{a}");
    });

    it("m:acc m:chr=˙ 输出 \\dot", () => {
        const xml = `<m:acc><m:accPr><m:chr m:val="˙"/></m:accPr><m:e>${mr("x")}</m:e></m:acc>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\dot{x}");
    });

    it("m:bar pos=top 输出 \\overline，pos=bot 输出 \\underline", () => {
        const top = `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${mr("x")}</m:e></m:bar>`;
        const bot = `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>${mr("x")}</m:e></m:bar>`;
        expect(ommlToLatex(parseMath(top)).latex).toBe("\\overline{x}");
        expect(ommlToLatex(parseMath(bot)).latex).toBe("\\underline{x}");
    });

    it("m:groupChr ⏟ 输出 \\underbrace，⏞ 输出 \\overbrace", () => {
        const under = `<m:groupChr><m:groupChrPr><m:chr m:val="⏟"/><m:pos m:val="bot"/></m:groupChrPr><m:e>${mr("x+y")}</m:e></m:groupChr>`;
        const over = `<m:groupChr><m:groupChrPr><m:chr m:val="⏞"/><m:pos m:val="top"/></m:groupChrPr><m:e>${mr("x+y")}</m:e></m:groupChr>`;
        expect(ommlToLatex(parseMath(under)).latex).toBe("\\underbrace{x+y}");
        expect(ommlToLatex(parseMath(over)).latex).toBe("\\overbrace{x+y}");
    });
});

describe("OMML 转 LaTeX：box、矩阵与嵌套", () => {
    it("m:box 取内容", () => {
        const xml = `<m:box><m:e>${mr("x")}</m:e></m:box>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("x");
    });

    it("m:borderBox 取内容", () => {
        const xml = `<m:borderBox><m:e>${mr("y")}</m:e></m:borderBox>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("y");
    });

    it("m:m 矩阵输出 \\begin{matrix}", () => {
        const xml = `<m:m><m:mr><m:e>${mr("a")}</m:e><m:e>${mr("b")}</m:e></m:mr><m:mr><m:e>${mr("c")}</m:e><m:e>${mr("d")}</m:e></m:mr></m:m>`;
        const { latex } = ommlToLatex(parseMath(xml));
        expect(latex).toContain("\\begin{matrix}");
        expect(latex).toContain("a & b \\\\ c & d");
        expect(latex).toContain("\\end{matrix}");
    });

    it("嵌套：分数里套根号与上下标", () => {
        const xml = `<m:f><m:num><m:rad><m:e><m:sSup><m:e>${mr("x")}</m:e><m:sup>${mr("2")}</m:sup></m:sSup></m:e></m:rad></m:num><m:den>${mr("2")}</m:den></m:f>`;
        expect(ommlToLatex(parseMath(xml)).latex).toBe("\\frac{\\sqrt{x^2}}{2}");
    });
});

describe("OMML 转 LaTeX：符号映射与转义", () => {
    it("常见 Unicode 符号映射", () => {
        const cases: Array<[string, string]> = [
            ["×", "\\times"],
            ["÷", "\\div"],
            ["≤", "\\le"],
            ["≥", "\\ge"],
            ["≠", "\\ne"],
            ["±", "\\pm"],
            ["∞", "\\infty"],
            ["π", "\\pi"],
            ["∠", "\\angle"],
            ["△", "\\triangle"],
            ["⊥", "\\perp"],
            ["∥", "\\parallel"],
            ["°", "^\\circ"],
        ];
        for (const [input, expected] of cases) {
            const { latex } = ommlToLatex(parseMath(mr(input)));
            expect(latex).toBe(expected);
        }
    });

    it("希腊字母映射", () => {
        const { latex } = ommlToLatex(parseMath(mr("αβγπΩ")));
        expect(latex).toBe("\\alpha\\beta\\gamma\\pi\\Omega");
    });

    it("LaTeX 特殊字符转义", () => {
        const { latex } = ommlToLatex(parseMath(mr("#$%&amp;_{}~^")));
        expect(latex).toBe("\\#\\$\\%\\&\\_\\{\\}\\sim \\hat{\\ }");
    });
});

describe("OMML 转 LaTeX：块级与 unsupported", () => {
    it("m:oMathPara 包含多个 m:oMath", () => {
        const xml = `<m:oMath>${mr("a")}</m:oMath><m:oMath>${mr("b")}</m:oMath>`;
        const { latex } = ommlToLatex(parseMathPara(xml));
        expect(latex).toContain("a");
        expect(latex).toContain("b");
        expect(latex).toContain("\\quad");
    });

    it("无法识别的元素记录到 unsupported（去重）", () => {
        const xml = `<m:phant><m:e>${mr("x")}</m:e></m:phant><m:phant><m:e>${mr("y")}</m:e></m:phant>`;
        const { latex, unsupported } = ommlToLatex(parseMath(xml));
        expect(unsupported).toEqual(["phant"]);
        // 尽力输出其中文字
        expect(latex).toContain("x");
        expect(latex).toContain("y");
    });

    it("多种未识别元素名按出现顺序去重", () => {
        const xml = `<m:fooA>${mr("a")}</m:fooA><m:fooB>${mr("b")}</m:fooB><m:fooA>${mr("c")}</m:fooA>`;
        const { unsupported } = ommlToLatex(parseMath(xml));
        expect(unsupported).toEqual(["fooA", "fooB"]);
    });

    it("m:sty 与 m:scr 可忽略（不记录 unsupported）", () => {
        // m:sty/m:scr 是 m:rPr 的两种属性写法（子元素或属性均可）
        const xml = `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>x</m:t></m:r><m:r><m:rPr><m:scr m:val="monospace"/></m:rPr><m:t>y</m:t></m:r>`;
        const { latex, unsupported } = ommlToLatex(parseMath(xml));
        expect(unsupported).toEqual([]);
        expect(latex).toContain("x");
        expect(latex).toContain("y");
    });
});

describe("KaTeX 可渲染性", () => {
    it("转换结果中的特殊字符与极限能被 KaTeX 正常解析", async () => {
        const katex = (await import("katex")).default;
        const cases = [
            `<m:limLow><m:e>${'<m:r><m:t>lim</m:t></m:r>'}</m:e><m:lim><m:r><m:t>x→0</m:t></m:r></m:lim></m:limLow>`,
            `<m:r><m:t>#$%&amp;_{}~^\\</m:t></m:r>`,
        ];
        for (const xml of cases) {
            const doc = new DOMParser().parseFromString(`<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${xml}</m:oMath>`, "application/xml");
            const { latex } = ommlToLatex(doc.documentElement);
            expect(() => katex.renderToString(latex, { throwOnError: true })).not.toThrow();
        }
    });
});

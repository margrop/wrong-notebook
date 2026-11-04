/**
 * OMML（Office Math Markup Language，m:oMath）转 LaTeX。
 *
 * 纯 DOM 遍历，不依赖外部库。支持 Word 自带公式（插入→公式）常见的结构：
 * 分数、上下标、根式、分隔符（括号）、n 元运算符（∑∫∏）、函数名、
 * 上下极限、重音（hat/bar/vec/dot/tilde 等）、上下划线、组合符号
 * （⏟/⏞）、box/borderBox、方程组（eqArr）、矩阵，以及常见 Unicode
 * 数学符号映射与 LaTeX 特殊字符转义。
 *
 * 无法识别的元素：尽力输出其中文字并记录到 unsupported（元素名去重）。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */

export interface OmmlResult {
    latex: string;
    /** 未识别元素的 localName 列表（去重、按出现顺序） */
    unsupported: string[];
}

/** OMML 数学命名空间 */
const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";

/** 收集器：解析过程中记录未识别元素与供外部读取状态 */
interface OmmlCollector {
    unsupported: string[];
    unsupportedSet: Set<string>;
}

function createCollector(): OmmlCollector {
    return { unsupported: [], unsupportedSet: new Set<string>() };
}

function recordUnsupported(collector: OmmlCollector, localName: string): void {
    if (collector.unsupportedSet.has(localName)) return;
    collector.unsupportedSet.add(localName);
    collector.unsupported.push(localName);
}

function isMElement(node: Node, local: string): node is Element {
    return node.nodeType === node.ELEMENT_NODE && (node as Element).localName === local && (node as Element).namespaceURI === M;
}

/** 取 m:val 属性值（OMML 属性一般无命名空间前缀） */
function mVal(element: Element, attr: string): string | null {
    // getAttributeNS(M, attr) 兼容带命名空间的写法；普通 docx 中属性多无前缀
    return element.getAttributeNS(M, attr) ?? element.getAttribute(attr) ?? element.getAttribute(`m:${attr}`);
}

/** 读 OMML 属性写法：既支持 <m:naryPr m:chr="∑"/> 属性形式，
 *  也支持 <m:naryPr><m:chr m:val="∑"/></m:naryPr> 子元素形式 */
function propVal(parent: Element | null, prop: string): string | null {
    if (!parent) return null;
    const attr = mVal(parent, prop);
    if (attr !== null) return attr;
    const child = childOf(parent, prop);
    if (!child) return null;
    return mVal(child, "val");
}

/** 取子元素文本（用于 m:t 等单文本节点） */
function textOf(element: Element): string {
    return element.textContent ?? "";
}

/** 找直接子元素（按命名空间+localName） */
function childOf(element: Element, local: string): Element | null {
    for (const child of Array.from(element.children)) {
        if (isMElement(child, local)) return child;
    }
    return null;
}

function childrenOf(element: Element, local: string): Element[] {
    return Array.from(element.children).filter((child) => isMElement(child, local));
}

/** 数学模式下不能用反斜杠直接转义的字符（\~、\^ 是文本模式重音命令，\\ 是换行） */
const MATH_ESCAPES: Record<string, string> = { "\\": "\\backslash ", "~": "\\sim ", "^": "\\hat{\\ }" };

/** LaTeX 特殊字符转义（# $ % & _ { } 加反斜杠；\ ~ ^ 换成数学模式可用的命令） */
export function escapeLatex(text: string): string {
    return text.replace(/[#$%&_{}\\~^]/g, (char) => MATH_ESCAPES[char] ?? `\\${char}`);
}

/** 常见 Unicode 数学符号 → LaTeX 命令（单字符映射） */
const SYMBOL_MAP: Record<string, string> = {
    "×": "\\times",
    "÷": "\\div",
    "≤": "\\le",
    "≥": "\\ge",
    "≠": "\\ne",
    "≈": "\\approx",
    "≡": "\\equiv",
    "±": "\\pm",
    "∓": "\\mp",
    "∝": "\\propto",
    "∞": "\\infty",
    "π": "\\pi",
    "∠": "\\angle",
    "△": "\\triangle",
    "□": "\\square",
    "⊥": "\\perp",
    "∥": "\\parallel",
    "°": "^\\circ",
    "√": "\\sqrt{}",
    "∴": "\\therefore",
    "∵": "\\because",
    "∈": "\\in",
    "∉": "\\notin",
    "∪": "\\cup",
    "∩": "\\cap",
    "⊂": "\\subset",
    "⊆": "\\subseteq",
    "⊃": "\\supset",
    "∀": "\\forall",
    "∃": "\\exists",
    "∑": "\\sum",
    "∏": "\\prod",
    "∫": "\\int",
    "∬": "\\iint",
    "∮": "\\oint",
    "→": "\\to",
    "←": "\\leftarrow",
    "↔": "\\leftrightarrow",
    "⇒": "\\Rightarrow",
    "⇔": "\\Leftrightarrow",
    "⋅": "\\cdot",
    "⊙": "\\odot",
    "⊗": "\\otimes",
    "∂": "\\partial",
    "∇": "\\nabla",
    "ℓ": "\\ell",
    "ℏ": "\\hbar",
    "′": "'",
    "″": "''",
};

/** 希腊字母映射（小写与大写） */
const GREEK_MAP: Record<string, string> = {
    α: "\\alpha",
    β: "\\beta",
    γ: "\\gamma",
    δ: "\\delta",
    ε: "\\varepsilon",
    ζ: "\\zeta",
    η: "\\eta",
    θ: "\\theta",
    ι: "\\iota",
    κ: "\\kappa",
    λ: "\\lambda",
    μ: "\\mu",
    ν: "\\nu",
    ξ: "\\xi",
    π: "\\pi",
    ρ: "\\rho",
    σ: "\\sigma",
    τ: "\\tau",
    υ: "\\upsilon",
    φ: "\\varphi",
    χ: "\\chi",
    ψ: "\\psi",
    ω: "\\omega",
    Α: "A",
    Β: "B",
    Γ: "\\Gamma",
    Δ: "\\Delta",
    Ε: "E",
    Ζ: "Z",
    Η: "H",
    Θ: "\\Theta",
    Ι: "I",
    Κ: "K",
    Λ: "\\Lambda",
    Μ: "M",
    Ν: "N",
    Ξ: "\\Xi",
    Ο: "O",
    Π: "\\Pi",
    Ρ: "P",
    Σ: "\\Sigma",
    Τ: "T",
    Υ: "Y",
    Φ: "\\Phi",
    Χ: "X",
    Ψ: "\\Psi",
    Ω: "\\Omega",
};

/** 重音符号映射（m:acc 的 m:chr） */
const ACCENT_MAP: Record<string, string> = {
    "̂": "\\hat",
    "^": "\\hat",
    "ˇ": "\\check",
    "˘": "\\breve",
    "¯": "\\bar",
    "‾": "\\overline",
    "˙": "\\dot",
    "¨": "\\ddot",
    "⃛": "\\dddot",
    "⃗": "\\vec",
    "˜": "\\tilde",
    "→": "\\vec",
    "´": "\\acute",
    "`": "\\grave",
};

/** m:nary 默认运算符（按 m:chr 覆盖） */
const NARY_DEFAULT_CHR: Record<string, string> = {
    "∑": "\\sum",
    "∏": "\\prod",
    "∐": "\\coprod",
    "∫": "\\int",
    "∬": "\\iint",
    "∭": "\\iiint",
    "∮": "\\oint",
    "⋀": "\\bigwedge",
    "⋁": "\\bigvee",
    "⋂": "\\bigcap",
    "⋃": "\\bigcup",
    "⨀": "\\bigodot",
    "⨂": "\\bigotimes",
    "⨁": "\\bigoplus",
};

/** m:func 函数名映射（常见三角、对数、极限等） */
const FUNC_MAP: Record<string, string> = {
    sin: "\\sin",
    cos: "\\cos",
    tan: "\\tan",
    cot: "\\cot",
    sec: "\\sec",
    csc: "\\csc",
    arcsin: "\\arcsin",
    arccos: "\\arccos",
    arctan: "\\arctan",
    sinh: "\\sinh",
    cosh: "\\cosh",
    tanh: "\\tanh",
    log: "\\log",
    ln: "\\ln",
    lg: "\\lg",
    lim: "\\lim",
    max: "\\max",
    min: "\\min",
    sup: "\\sup",
    inf: "\\inf",
    det: "\\det",
    exp: "\\exp",
    deg: "\\deg",
    gcd: "\\gcd",
};

/** 按 LaTeX 习惯为转义后文本加分组（用于上标、根指数等）；
 *  单字符直接输出（如 x^2），避免多一层 {}；含多字符时包 {} */
function group(latex: string): string {
    const trimmed = latex.trim();
    if (trimmed.length === 1) return trimmed;
    if (/^\\[a-zA-Z]+$/.test(trimmed)) return ` ${trimmed} `;
    return `{${trimmed}}`;
}

/** 处理 m:r 中的文字：应用 Unicode 符号映射与 LaTeX 转义 */
function mapText(text: string): string {
    let result = "";
    for (const char of text) {
        if (char in GREEK_MAP) {
            result += GREEK_MAP[char];
        } else if (char in SYMBOL_MAP) {
            result += SYMBOL_MAP[char];
        } else {
            result += escapeLatex(char);
        }
    }
    return result;
}

/** 读取 m:r/m:t 或 w:r/w:t 组合：m:r 可含多个 m:t 与 w:r */
function runContent(run: Element): string {
    let text = "";
    const nor = childOf(run, "rPr") !== null && childOf(childOf(run, "rPr") as Element, "nor") !== null;
    for (const child of Array.from(run.childNodes)) {
        if (child.nodeType !== child.ELEMENT_NODE) continue;
        if (isMElement(child, "t") || ((child as Element).localName === "t" && (child as Element).namespaceURI !== M)) {
            text += textOf(child as Element);
        } else if (isMElement(child, "br")) {
            text += " ";
        }
    }
    const mapped = mapText(text);
    return nor ? `\\text{${text.replace(/\\/g, "\\\\").replace(/[#$%&_{}~^]/g, (c) => `\\${c}`)}}` : mapped;
}

/** 遍历一组子元素（不进入嵌套的 m:oMath 结构，仅顶层子元素） */
function sequenceContent(elements: Element[], collector: OmmlCollector): string {
    return elements.map((element) => convertElement(element, collector)).join("");
}

/** 所有子元素内容（含 m:t 等文本节点元素） */
function allChildrenContent(element: Element, collector: OmmlCollector): string {
    const parts: string[] = [];
    for (const child of Array.from(element.children)) {
        parts.push(convertElement(child, collector));
    }
    return parts.join("");
}

/** m:f 分数：支持 m:type=lin（线性 a/b）、skw（斜线）、noBar（无分数线，用 \atop 表达） */
function convertFraction(element: Element, collector: OmmlCollector): string {
    const type = propVal(childOf(element, "fPr"), "type") ?? "bar";
    const numerator = childOf(element, "num");
    const denominator = childOf(element, "den");
    const numLatex = numerator ? allChildrenContent(numerator, collector) : "";
    const denLatex = denominator ? allChildrenContent(denominator, collector) : "";
    if (type === "lin") return `${numLatex}/${denLatex}`;
    if (type === "skw") return `${numLatex}\\big/${denLatex}`;
    if (type === "noBar") return `{${numLatex} \\atop ${denLatex}}`;
    return `\\frac{${numLatex}}{${denLatex}}`;
}

/** m:sSup / m:sSub / m:sSubSup */
function convertSupSub(element: Element, collector: OmmlCollector, kind: "sup" | "sub" | "subsup"): string {
    const base = childOf(element, "e");
    const sup = childOf(element, "sup");
    const sub = childOf(element, "sub");
    const baseLatex = base ? allChildrenContent(base, collector) : "";
    if (kind === "sup") {
        const supLatex = sup ? allChildrenContent(sup, collector) : "";
        return `${baseLatex}^${group(supLatex)}`;
    }
    if (kind === "sub") {
        const subLatex = sub ? allChildrenContent(sub, collector) : "";
        return `${baseLatex}_${group(subLatex)}`;
    }
    const subLatex = sub ? allChildrenContent(sub, collector) : "";
    const supLatex = sup ? allChildrenContent(sup, collector) : "";
    return `${baseLatex}_${group(subLatex)}^${group(supLatex)}`;
}

/** m:sPre（上标在下标前的特殊结构，常见于化学式等） */
function convertSPre(element: Element, collector: OmmlCollector): string {
    const base = childOf(element, "e");
    const sup = childOf(element, "sup");
    const sub = childOf(element, "sub");
    return `${base ? allChildrenContent(base, collector) : ""}_${sub ? group(allChildrenContent(sub, collector)) : ""}^{${sup ? allChildrenContent(sup, collector) : ""}}`;
}

/** m:rad 根式：m:degHide=1 隐藏根指数；否则输出 \sqrt[n]{} */
function convertRadical(element: Element, collector: OmmlCollector): string {
    const deg = childOf(element, "deg");
    const base = childOf(element, "e");
    const baseLatex = base ? allChildrenContent(base, collector) : "";
    const degHide = propVal(childOf(element, "radPr"), "degHide") ?? mVal(element, "degHide");
    if (degHide === "1" || !deg || deg.children.length === 0) return `\\sqrt{${baseLatex}}`;
    const degLatex = allChildrenContent(deg, collector);
    return `\\sqrt[${degLatex}]{${baseLatex}}`;
}

/** m:d 分隔符：m:begChr/m:endChr/m:sepChr，缺省圆括号；
 *  左大括号 + m:eqArr 组合输出 cases（方程组），其余内容按行拼接 */
function convertDelimiter(element: Element, collector: OmmlCollector): string {
    const dPr = childOf(element, "dPr");
    const beg = propVal(dPr, "begChr") ?? "(";
    const closing = propVal(dPr, "endChr") ?? ")";

    // 内容：跳过 dPr，找 m:e；若 e 内含 m:eqArr 且 begChr 为 {，输出 cases
    const eChildren = childrenOf(element, "e");
    const eqArr = eChildren
        .map((e) => Array.from(e.children).find((child) => isMElement(child, "eqArr")))
        .find((el): el is Element => el !== undefined);
    if (eqArr && beg === "{") {
        const rows = childrenOf(eqArr, "e");
        const body = rows.map((row) => allChildrenContent(row, collector)).join(" \\\\ ");
        return `\\begin{cases} ${body} \\end{cases}`;
    }
    const content = eChildren.length > 0
        ? eChildren.map((e) => allChildrenContent(e, collector)).join("")
        : sequenceContent(Array.from(element.children).filter((child) => !isMElement(child, "dPr")), collector);
    return `${beg}${content}${closing}`;
}

/** m:nary：m:chr 决定运算符，m:limLoc 决定上下限位置，m:subHide/m:supHide 隐藏上下限 */
function convertNary(element: Element, collector: OmmlCollector): string {
    const dPr = childOf(element, "naryPr");
    const chr = propVal(dPr, "chr") ?? "∫";
    const limLoc = propVal(dPr, "limLoc") ?? "undOvr";
    const op = NARY_DEFAULT_CHR[chr] ?? mapText(chr);
    const sub = childOf(element, "sub");
    const sup = childOf(element, "sup");
    const base = childOf(element, "e");
    // subHide/supHide 是 m:naryPr 的属性（如 <m:naryPr m:subHide="1">）
    const subHide = propVal(dPr, "subHide");
    const supHide = propVal(dPr, "supHide");
    const subLatex = sub && subHide !== "1" ? allChildrenContent(sub, collector) : "";
    const supLatex = sup && supHide !== "1" ? allChildrenContent(sup, collector) : "";
    const baseLatex = base ? allChildrenContent(base, collector) : "";
    if (limLoc === "undOvr") {
        return `${op}${subLatex ? `_${group(subLatex)}` : ""}${supLatex ? `^${group(supLatex)}` : ""} ${baseLatex}`;
    }
    // limLoc=undOvr 之外的（如 subSup）按上下标排版
    return `${op}${subLatex ? `_${group(subLatex)}` : ""}${supLatex ? `^${group(supLatex)}` : ""} ${baseLatex}`;
}

/** m:func：函数名 → \sin 等，参数作为分组 */
function convertFunc(element: Element, collector: OmmlCollector): string {
    const fname = childOf(element, "fName");
    const base = childOf(element, "e");
    let name = "";
    if (fname) {
        // fName 内含 m:r/m:t，直接拼接文本（支持 "sin"、"lim" 等）
        const parts: string[] = [];
        for (const child of Array.from(fname.childNodes)) {
            if (child.nodeType !== child.ELEMENT_NODE) continue;
            if (isMElement(child, "r")) {
                for (const t of Array.from((child as Element).getElementsByTagNameNS(M, "t"))) {
                    parts.push(textOf(t));
                }
            }
        }
        name = parts.join("");
    }
    const mapped = FUNC_MAP[name] ?? `\\operatorname{${escapeLatex(name)}}`;
    const baseLatex = base ? allChildrenContent(base, collector) : "";
    return `${mapped}${baseLatex ? `{${baseLatex}}` : ""}`;
}

/** m:limLow / m:limUpp：底线/顶线极限（如 \lim_{x\to0} 的 x→0 部分） */
function convertLim(element: Element, collector: OmmlCollector, kind: "low" | "upp"): string {
    const base = childOf(element, "e");
    const lim = childOf(element, "lim");
    const rawBase = base ? allChildrenContent(base, collector) : "";
    // 底数是 lim、max、min 等函数名时换成对应命令（\lim），否则 KaTeX 会显示成斜体字母
    const baseLatex = FUNC_MAP[rawBase.trim()] ?? rawBase;
    const limLatex = lim ? allChildrenContent(lim, collector) : "";
    if (kind === "low") return `${baseLatex}_{${limLatex}}`;
    return `${baseLatex}^{${limLatex}}`;
}

/** m:acc 重音：按 m:chr 映射到 \hat/\bar/\vec/\dot/\tilde 等 */
function convertAccent(element: Element, collector: OmmlCollector): string {
    const dPr = childOf(element, "accPr");
    const chr = propVal(dPr, "chr") ?? "̂";
    const base = childOf(element, "e");
    const baseLatex = base ? allChildrenContent(base, collector) : "";
    const accent = ACCENT_MAP[chr] ?? "\\hat";
    if (accent === "\\overline" || accent === "\\underline") return `${accent}{${baseLatex}}`;
    return `${accent}{${baseLatex}}`;
}

/** m:bar 上划线/下划线 */
function convertBar(element: Element, collector: OmmlCollector): string {
    const dPr = childOf(element, "barPr");
    const pos = propVal(dPr, "pos") ?? "top";
    const base = childOf(element, "e");
    const baseLatex = base ? allChildrenContent(base, collector) : "";
    return pos === "bot" ? `\\underline{${baseLatex}}` : `\\overline{${baseLatex}}`;
}

/** m:groupChr：组合符号（⏟ → \underbrace，⏞ → \overbrace 等） */
function convertGroupChr(element: Element, collector: OmmlCollector): string {
    const dPr = childOf(element, "groupChrPr");
    const chr = propVal(dPr, "chr") ?? "⏞";
    const pos = propVal(dPr, "pos") ?? "top";
    const base = childOf(element, "e");
    const baseLatex = base ? allChildrenContent(base, collector) : "";
    const under = chr === "⏟" || pos === "bot";
    const cmd = under ? "\\underbrace" : "\\overbrace";
    return `${cmd}{${baseLatex}}`;
}

/** m:eqArr 方程组：与 m:d 左大括号组合时输出 cases，否则 aligned */
function convertEqArray(element: Element, collector: OmmlCollector): string {
    const rows = childrenOf(element, "e");
    const body = rows.map((row) => allChildrenContent(row, collector)).join(" \\\\ ");
    // 若外层 d 的 begChr 为 { 已由 convertDelimiter 包裹；这里输出环境
    return `\\begin{aligned} ${body} \\end{aligned}`;
}

/** m:m 矩阵：按 m:mr 分行，单元格用 & 分隔 */
function convertMatrix(element: Element, collector: OmmlCollector): string {
    const rows: string[] = [];
    for (const mr of childrenOf(element, "mr")) {
        const cells = childrenOf(mr, "e");
        rows.push(cells.map((cell) => allChildrenContent(cell, collector)).join(" & "));
    }
    if (rows.length === 0) {
        // 无 mr 的单行
        const cells = childrenOf(element, "e");
        if (cells.length > 0) rows.push(cells.map((cell) => allChildrenContent(cell, collector)).join(" & "));
    }
    return `\\begin{matrix} ${rows.join(" \\\\ ")} \\end{matrix}`;
}

/** 分发单个 OMML 元素转换 */
function convertElement(element: Element, collector: OmmlCollector): string {
    if (element.namespaceURI !== M) {
        // 非 m: 命名空间（如 w:r 嵌入）：尽力提取文字
        return element.textContent ?? "";
    }
    switch (element.localName) {
        case "r":
            return runContent(element);
        case "t":
            return mapText(textOf(element));
        case "f":
            return convertFraction(element, collector);
        case "sSup":
            return convertSupSub(element, collector, "sup");
        case "sSub":
            return convertSupSub(element, collector, "sub");
        case "sSubSup":
            return convertSupSub(element, collector, "subsup");
        case "sPre":
            return convertSPre(element, collector);
        case "rad":
            return convertRadical(element, collector);
        case "d":
            return convertDelimiter(element, collector);
        case "nary":
            return convertNary(element, collector);
        case "func":
            return convertFunc(element, collector);
        case "limLow":
            return convertLim(element, collector, "low");
        case "limUpp":
            return convertLim(element, collector, "upp");
        case "acc":
            return convertAccent(element, collector);
        case "bar":
            return convertBar(element, collector);
        case "groupChr":
            return convertGroupChr(element, collector);
        case "eqArr":
            return convertEqArray(element, collector);
        case "m":
            return convertMatrix(element, collector);
        case "box":
        case "borderBox": {
            // 取内容：box 有 m:e 子元素；borderBox 同样有 m:e
            const e = childOf(element, "e");
            return e ? allChildrenContent(e, collector) : "";
        }
        case "e":
            return allChildrenContent(element, collector);
        case "oMath":
        case "oMathPara":
            return allChildrenContent(element, collector);
        case "sty":
        case "scr":
        case "rPr":
        case "ctrlPr":
        case "dPr":
        case "naryPr":
        case "accPr":
        case "barPr":
        case "groupChrPr":
        case "fPr":
        case "radPr":
        case "sSupPr":
        case "sSubPr":
        case "sSubSupPr":
        case "sPrePr":
        case "limLowPr":
        case "limUppPr":
        case "mPr":
        case "mr":
        case "nor":
            return "";
        default: {
            recordUnsupported(collector, element.localName);
            // 尽力输出其中文字（递归处理子元素，已识别的子结构仍可用）
            return allChildrenContent(element, collector);
        }
    }
}

/** m:oMathPara 内容：把每个 m:oMath 拼成一行 */
function convertOMathPara(element: Element, collector: OmmlCollector): string {
    const parts: string[] = [];
    for (const child of Array.from(element.children)) {
        if (isMElement(child, "oMath")) {
            parts.push(convertElement(child, collector));
        }
    }
    if (parts.length === 0) return allChildrenContent(element, collector);
    return parts.join(" \\quad ");
}

/**
 * 把 m:oMath 或 m:oMathPara 元素转为 LaTeX。
 * 返回 latex 字符串与无法识别元素名列表（去重）。
 */
export function ommlToLatex(element: Element): OmmlResult {
    const collector = createCollector();
    const isPara = isMElement(element, "oMathPara");
    const latex = isPara ? convertOMathPara(element, collector) : convertElement(element, collector);
    return { latex, unsupported: collector.unsupported };
}

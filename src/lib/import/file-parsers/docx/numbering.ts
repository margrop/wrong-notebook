/**
 * Word 自动编号解析：根据 numbering.xml 与段落/样式上的 w:numPr，
 * 为每个带编号段落计算编号文本并加在段首。
 *
 * 支持格式：decimal、chineseCounting、chineseCountingThousand、ideographTraditional、
 * upperLetter、lowerLetter、upperRoman、lowerRoman、decimalEnclosedCircle、bullet
 * （bullet 直接用 lvlText 的符号）；其余格式按 decimal 处理。
 * 计数器按 numId+ilvl 维护；上级层级变化时重置下级计数器。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

interface NumberLevel {
    numFmt: string;
    lvlText: string;
    start: number;
}

interface NumberingInstance {
    abstractId: string;
    /** lvlIndex → 覆盖值（startOverride / lvlText / numFmt） */
    overrides: Map<number, Partial<NumberLevel>>;
}

export class NumberingResolver {
    private readonly abstractLevels = new Map<string, Map<number, NumberLevel>>();
    private readonly instances = new Map<string, NumberingInstance>();
    private readonly styleLinks = new Map<string, string>();

    /** 每个 numId+ilvl 的当前计数（运行期状态） */
    private readonly counters = new Map<string, number>();

    constructor(numberingDoc: Document | null, stylesDoc: Document | null) {
        if (numberingDoc) {
            this.loadAbstractNums(numberingDoc);
            this.loadNums(numberingDoc);
        }
        if (stylesDoc) {
            this.loadStyleLinks(stylesDoc);
        }
    }

    private loadAbstractNums(doc: Document): void {
        for (const abstractNum of Array.from(doc.getElementsByTagNameNS(W, "abstractNum"))) {
            const id = abstractNum.getAttributeNS(W, "abstractNumId");
            if (!id) continue;
            const levels = new Map<number, NumberLevel>();
            for (const lvl of Array.from(abstractNum.getElementsByTagNameNS(W, "lvl"))) {
                const ilvl = Number(lvl.getAttributeNS(W, "ilvl") ?? "");
                if (!Number.isInteger(ilvl)) continue;
                const numFmt = lvl.getElementsByTagNameNS(W, "numFmt")[0]?.getAttributeNS(W, "val") ?? "decimal";
                const lvlText = lvl.getElementsByTagNameNS(W, "lvlText")[0]?.getAttributeNS(W, "val") ?? "%1.";
                const start = Number(lvl.getElementsByTagNameNS(W, "start")[0]?.getAttributeNS(W, "val") ?? "1");
                levels.set(ilvl, { numFmt, lvlText, start: Number.isFinite(start) ? start : 1 });
            }
            this.abstractLevels.set(id, levels);
        }
    }

    private loadNums(doc: Document): void {
        for (const num of Array.from(doc.getElementsByTagNameNS(W, "num"))) {
            const numId = num.getAttributeNS(W, "numId");
            const abstractId = num.getElementsByTagNameNS(W, "abstractNumId")[0]?.getAttributeNS(W, "val");
            if (!numId || !abstractId) continue;
            const overrides = new Map<number, Partial<NumberLevel>>();
            for (const override of Array.from(num.getElementsByTagNameNS(W, "lvlOverride"))) {
                const ilvl = Number(override.getAttributeNS(W, "ilvl") ?? "");
                if (!Number.isInteger(ilvl)) continue;
                const entry: Partial<NumberLevel> = {};
                const startOverride = override.getElementsByTagNameNS(W, "startOverride")[0]?.getAttributeNS(W, "val");
                if (startOverride !== undefined && startOverride !== null) {
                    const start = Number(startOverride);
                    if (Number.isFinite(start)) entry.start = start;
                }
                const lvl = override.getElementsByTagNameNS(W, "lvl")[0];
                if (lvl) {
                    const numFmt = lvl.getElementsByTagNameNS(W, "numFmt")[0]?.getAttributeNS(W, "val");
                    if (numFmt) entry.numFmt = numFmt;
                    const lvlText = lvl.getElementsByTagNameNS(W, "lvlText")[0]?.getAttributeNS(W, "val");
                    if (lvlText) entry.lvlText = lvlText;
                }
                overrides.set(ilvl, entry);
            }
            this.instances.set(numId, { abstractId, overrides });
        }
    }

    /** 段落样式（pStyle）与 numId 的关联：样式链接的段落直接继承编号 */
    private loadStyleLinks(stylesDoc: Document): void {
        for (const style of Array.from(stylesDoc.getElementsByTagNameNS(W, "style"))) {
            const styleId = style.getAttributeNS(W, "styleId");
            if (!styleId) continue;
            const numPr = style.getElementsByTagNameNS(W, "numPr")[0];
            if (!numPr) continue;
            const numId = numPr.getElementsByTagNameNS(W, "numId")[0]?.getAttributeNS(W, "val");
            if (numId) this.styleLinks.set(styleId, numId);
        }
    }

    /** 解析段落的 w:numPr → [numId, ilvl]；无编号时返回 null */
    resolveNumPr(paragraph: Element): [string, number] | null {
        const pPr = paragraph.getElementsByTagNameNS(W, "pPr")[0];
        if (!pPr) return null;
        const numPr = pPr.getElementsByTagNameNS(W, "numPr")[0];
        let numId: string | null = null;
        let ilvl = 0;
        if (numPr) {
            numId = numPr.getElementsByTagNameNS(W, "numId")[0]?.getAttributeNS(W, "val") ?? null;
            const ilvlRaw = numPr.getElementsByTagNameNS(W, "ilvl")[0]?.getAttributeNS(W, "val");
            if (ilvlRaw !== undefined && ilvlRaw !== null) {
                const parsed = Number(ilvlRaw);
                if (Number.isInteger(parsed) && parsed >= 0) ilvl = parsed;
            }
        }
        // 段落未直接指定编号时，从 pStyle 继承
        if (!numId) {
            const pStyle = pPr.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val");
            if (pStyle) numId = this.styleLinks.get(pStyle) ?? null;
        }
        if (!numId || numId === "0") return null;
        return [numId, ilvl];
    }

    private getLevel(numId: string, ilvl: number): NumberLevel | null {
        const instance = this.instances.get(numId);
        if (!instance) return null;
        const base = this.abstractLevels.get(instance.abstractId)?.get(ilvl);
        if (!base) return null;
        const override = instance.overrides.get(ilvl);
        if (!override) return base;
        return {
            numFmt: override.numFmt ?? base.numFmt,
            lvlText: override.lvlText ?? base.lvlText,
            start: override.start ?? base.start,
        };
    }

    /** 上级层级变化时重置下级计数器（同级编号递增时，更深的层级要重新开始） */
    private resetDeeperLevels(numId: string, ilvl: number): void {
        for (const key of this.counters.keys()) {
            const [keyNumId, keyIlvl] = key.split(":");
            if (keyNumId === numId && Number(keyIlvl) > ilvl) this.counters.delete(key);
        }
    }

    /** 取当前计数并递增；首次使用时取 start */
    private take(numId: string, ilvl: number, start: number): number {
        const key = `${numId}:${ilvl}`;
        const current = this.counters.get(key);
        if (current === undefined) {
            this.counters.set(key, start + 1);
            return start;
        }
        this.counters.set(key, current + 1);
        return current;
    }

    /** 格式化单级编号 */
    private format(numFmt: string, value: number): string {
        switch (numFmt) {
            case "chineseCounting":
            case "chineseCountingThousand":
            case "ideographTraditional":
                return toChineseNumber(value);
            case "upperLetter": {
                if (value < 1 || value > 26) return String(value);
                return String.fromCharCode(64 + value);
            }
            case "lowerLetter": {
                if (value < 1 || value > 26) return String(value);
                return String.fromCharCode(96 + value);
            }
            case "upperRoman": {
                const roman = toRoman(value);
                return roman.toUpperCase();
            }
            case "lowerRoman":
                return toRoman(value);
            case "decimalEnclosedCircle": {
                if (value >= 1 && value <= 20) return String.fromCharCode(0x2460 + value - 1);
                return String(value);
            }
            case "decimal":
            default:
                return String(value);
        }
    }

    /**
     * 计算段落的编号文本（不含尾随空格）。
     * 编号文本形如 "1."、"（一）"、"1.1"、""（bullet 用 lvlText 符号，如 "• "）。
     * 返回 null 表示段落无自动编号。
     */
    paragraphNumber(numId: string, ilvl: number): string | null {
        const level = this.getLevel(numId, ilvl);
        if (!level) return null;
        this.resetDeeperLevels(numId, ilvl);
        const value = this.take(numId, ilvl, level.start);

        if (level.numFmt === "bullet") {
            return level.lvlText;
        }
        // 填充 lvlText 中的 %1、%2 等占位符（上级层级取当前计数）
        const text = level.lvlText.replace(/%(\d+)/g, (_match, position: string) => {
            const levelIndex = Number(position) - 1;
            if (levelIndex === ilvl) return this.format(level.numFmt, value);
            const parentLevel = this.getLevel(numId, levelIndex);
            if (!parentLevel) return "";
            const parentValue = this.counters.get(`${numId}:${levelIndex}`) ?? parentLevel.start;
            return this.format(parentLevel.numFmt, parentValue - 1);
        });
        return text;
    }
}

/** 汉字数字（1～9999） */
export function toChineseNumber(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return String(value);
    if (value > 9999) return String(value);
    const digits = "零一二三四五六七八九";
    if (value < 10) return digits[value];
    if (value === 10) return "十";
    if (value < 20) return `十${digits[value % 10]}`;
    if (value < 100) {
        const tens = Math.floor(value / 10);
        const ones = value % 10;
        return `${digits[tens]}十${ones ? digits[ones] : ""}`;
    }
    if (value < 1000) {
        const hundreds = Math.floor(value / 100);
        const rest = value % 100;
        if (rest === 0) return `${digits[hundreds]}百`;
        if (rest < 10) return `${digits[hundreds]}百零${digits[rest]}`;
        return `${digits[hundreds]}百${toChineseNumber(rest)}`;
    }
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    if (rest === 0) return `${digits[thousands]}千`;
    if (rest < 100) return `${digits[thousands]}千零${toChineseNumber(rest)}`;
    return `${digits[thousands]}千${toChineseNumber(rest)}`;
}

const ROMAN_TABLE: Array<[number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"],
    [100, "c"], [90, "xc"], [50, "l"], [40, "xl"],
    [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

/** 罗马数字（小写，1～3999；超出返回原数字符串） */
export function toRoman(value: number): string {
    if (!Number.isFinite(value) || value <= 0 || value >= 4000) return String(value);
    let remaining = value;
    let result = "";
    for (const [num, symbol] of ROMAN_TABLE) {
        while (remaining >= num) {
            result += symbol;
            remaining -= num;
        }
    }
    return result;
}

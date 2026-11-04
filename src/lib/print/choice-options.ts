/**
 * 打印排版：把题干末尾逐行排列的选择题选项拆出来，按选项长度排成 4 列、2 列或 1 列，
 * 避免短选项每个独占一行浪费纸张。前后端共用，不要引入服务端模块。
 */
import { extractMathSegments, restoreMathSegments, separateChoiceOptions } from '@/lib/markdown-math';

export interface ChoiceOption {
    /** 原样保留的选项标记，如 "A."、"B．"、"（C）" */
    label: string;
    content: string;
}

export type ChoiceColumns = 1 | 2 | 4;

export interface ChoiceOptionsLayout {
    /** 选项之前的题干 */
    stem: string;
    options: ChoiceOption[];
    /** 选项之后的其余内容（如「图示：」段落） */
    after: string;
    columns: ChoiceColumns;
}

const LETTERS = ['A', 'B', 'C', 'D'] as const;

/** 4 列、2 列排版允许的最长选项宽度（中文、全角字符按 2 计，其余按 1 计） */
const FOUR_COLUMN_MAX_WIDTH = 14;
const TWO_COLUMN_MAX_WIDTH = 34;

/** 行首的某个选项标记：A. / A．/ A: / A：/ A、/ (A) / （A） */
function leadingMarker(letter: string): RegExp {
    return new RegExp(`^(?:${letter}\\s*[.．:：、]|[(（]${letter}[)）])`);
}

/** 行内空白之后的某个选项标记，用于拆分同一行里的多个选项 */
function innerMarker(letter: string): RegExp {
    return new RegExp(`\\s(?:${letter}\\s*[.．:：、]|[(（]${letter}[)）])`);
}

/** 把一行（已确认以 letters[from] 开头）拆成若干选项，返回选项和下一个待匹配的字母序号 */
function splitOptionLine(line: string, from: number): { options: ChoiceOption[]; next: number } {
    const options: ChoiceOption[] = [];
    let rest = line;
    let index = from;
    while (index < LETTERS.length) {
        const label = rest.match(leadingMarker(LETTERS[index]))![0];
        rest = rest.slice(label.length);
        const nextMatch = index + 1 < LETTERS.length ? rest.match(innerMarker(LETTERS[index + 1])) : null;
        const end = nextMatch?.index ?? rest.length;
        options.push({ label: label.trim(), content: rest.slice(0, end).trim() });
        index += 1;
        if (!nextMatch) break;
        rest = rest.slice(end).trimStart();
    }
    return { options, next: index };
}

/** 估算选项显示宽度：公式按去掉命令和括号后的字符计，中文、全角字符按 2 计 */
function displayWidth(text: string): number {
    const plain = text.replace(/\$+/g, '').replace(/\\[a-zA-Z]+/g, '').replace(/[{}^_\\]/g, '');
    let width = 0;
    for (const char of plain) width += char.codePointAt(0)! >= 0x2e80 ? 2 : 1;
    return width;
}

function chooseColumns(options: ChoiceOption[]): ChoiceColumns {
    // 图片、表格等块级内容只能整行显示
    if (options.some(({ content }) => /!\[|\|/.test(content))) return 1;
    const widest = Math.max(...options.map(({ label, content }) => displayWidth(label) + 1 + displayWidth(content)));
    if (widest <= FOUR_COLUMN_MAX_WIDTH) return 4;
    if (widest <= TWO_COLUMN_MAX_WIDTH) return 2;
    return 1;
}

/**
 * 拆出逐行排列的选择题选项；不是选择题、选项已在同一行或格式无法可靠识别时返回 null，按原文渲染
 */
export function splitChoiceOptions(content: string | null | undefined): ChoiceOptionsLayout | null {
    if (!content) return null;
    const { masked, segments } = extractMathSegments(content.replace(/\\n/g, '\n'));
    // 题干与 A 选项在同一行时先拆开
    const lines = separateChoiceOptions(masked, '\n').split('\n');

    const start = lines.findIndex((line) => leadingMarker('A').test(line.trim()));
    if (start < 0) return null;

    const options: ChoiceOption[] = [];
    let next = 0;
    let end = start;
    for (let i = start; i < lines.length && next < LETTERS.length; i += 1) {
        const line = lines[i].trim();
        if (!line) continue;
        if (!leadingMarker(LETTERS[next]).test(line)) break;
        const result = splitOptionLine(line, next);
        options.push(...result.options);
        next = result.next;
        end = i + 1;
    }

    // 至少 A、B、C 三项，且全部选项原本就分在多行才需要重排
    if (options.length < 3 || end - start < 2) return null;
    const after = lines.slice(end).join('\n').trim();
    // 未到 D 就中断时，后面的文字可能是多行选项的续行，无法可靠拆分
    if (next < LETTERS.length && after) return null;

    const restore = (text: string) => restoreMathSegments(text, segments);
    const restored = options.map((option) => ({ label: option.label, content: restore(option.content) }));
    return {
        stem: restore(lines.slice(0, start).join('\n').trim()),
        options: restored,
        after: restore(after),
        columns: chooseColumns(restored),
    };
}

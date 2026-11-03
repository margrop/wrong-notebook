/**
 * 文字多题的本地分题规则（确定性，不调用 AI），浏览器实时提示与服务端建批次共用。
 *
 * - 顶层题号：`1．` `1.` `1、` `1)` `第1题` `例1` `Q1` `Question 1`。同一份文字取「同一种写法、编号连续递增」的最长序列，
 *   不同写法（如 `1)` 小问）、选项 `A．`、小问 `（1）` `①` 都留在所属题内，避免把一道大题拆散。
 * - 只有汉字序号（`一、` `二、`）而没有阿拉伯题号时，汉字序号作为题号；否则作为大题分组标题。
 * - 首题之前：姓名/班级/日期栏、标题、「共 N 道」等说明列入忽略内容（可在预览中恢复）；阅读材料作为公共材料。
 * - 题与题之间的空行去掉，题内保留原文（分数、符号、公式原样），只去掉行首缩进。
 * - 找不到两道以上的编号题时不猜测，交给用户选择「作为一道题」或「用 AI 分题」。
 */

/** 一道题的分题结果（不含界面状态） */
export interface SplitTextQuestion {
    /** 原文中的题号，如 "1"；没有时为 null */
    label: string | null;
    /** 题目正文（已去掉顶层题号） */
    text: string;
    /** 公共材料（阅读材料、题组说明），解析时拼在题干前 */
    material: string | null;
    /** 所在大题的分组标题，如「一、选择题」，只用于显示 */
    section: string | null;
}

export interface TextSplitResult {
    questions: SplitTextQuestion[];
    /** 未计入任何题目的内容（标题、姓名栏、答案页等，以及超出题数上限的题），按段落列出 */
    ignored: string[];
    /** 是否检测到两道及以上的编号题 */
    detected: boolean;
    /**
     * 编号可能是同一道题的小问（如公共题干后的 1) 2)、「完成下列小题：」后的编号）：
     * 不自动拆分，按一道题返回，由用户选择「作为一道题」「仍按编号分题」或「用 AI 分题」
     */
    ambiguous: boolean;
    /** 按编号可分出的题数（ambiguous 时也给出，用于提示） */
    candidateCount: number;
    /** 超出题数上限、已列入 ignored 的题数 */
    overflow: number;
    /** 文字超过长度上限，超出部分未参与分题 */
    tooLong: boolean;
}

export interface TextSplitOptions {
    /** 即使编号像小问也按编号分题（用户在提示后明确选择） */
    forceNumbered?: boolean;
}

/** 单次分题最多处理的文字长度与题数 */
export const MAX_SPLIT_TEXT_LENGTH = 20000;
export const MAX_SPLIT_QUESTIONS = 60;

const LEADING_SPACE = /^[\s　 ]+/;
const CHINESE_DIGITS = '一二三四五六七八九十';

type NumberFamily = 'dot' | 'comma' | 'paren' | 'colon' | 'ti' | 'example' | 'q' | 'cn';

interface NumberMatch {
    value: number;
    family: NumberFamily;
    /** 题号本身（含分隔符）的长度，用于从正文中去掉 */
    prefixLength: number;
    label: string;
}

function chineseToNumber(text: string): number {
    if (/^\d+$/.test(text)) return Number(text);
    if (text === '十') return 10;
    const tenIndex = text.indexOf('十');
    if (tenIndex === -1) return CHINESE_DIGITS.indexOf(text) + 1;
    const tens = tenIndex === 0 ? 1 : CHINESE_DIGITS.indexOf(text[0]) + 1;
    const ones = tenIndex === text.length - 1 ? 0 : CHINESE_DIGITS.indexOf(text[tenIndex + 1]) + 1;
    return tens * 10 + ones;
}

const NUMBER_PATTERNS: Array<{ family: NumberFamily; pattern: RegExp }> = [
    // 1. 1．（不把 1.5 这样的小数当题号）
    { family: 'dot', pattern: /^(\d{1,3})\s*[.．](?!\d)\s*/ },
    { family: 'comma', pattern: /^(\d{1,3})\s*[、，,](?!\d)\s*/ },
    { family: 'paren', pattern: /^(\d{1,3})\s*[)）]\s*/ },
    { family: 'colon', pattern: /^(\d{1,3})\s*[:：](?!\d)\s*/ },
    { family: 'ti', pattern: /^第\s*(\d{1,3}|[一二三四五六七八九十]{1,3})\s*题\s*[.．、:：]?\s*/ },
    { family: 'example', pattern: /^(?:例题?|练习|习题)\s*(\d{1,3})\s*[.．、:：]?\s*/ },
    { family: 'q', pattern: /^(?:Q|Question|Problem|Exercise)\s*(\d{1,3})\s*[.．:：)]?\s+/i },
    { family: 'cn', pattern: /^([一二三四五六七八九十]{1,3})\s*[、.．]\s*/ },
];

/** 识别行首的题号；行内容必须在题号后还有文字 */
export function matchQuestionNumber(line: string): NumberMatch | null {
    const trimmed = line.replace(LEADING_SPACE, '');
    for (const { family, pattern } of NUMBER_PATTERNS) {
        const match = trimmed.match(pattern);
        if (!match || trimmed.length <= match[0].length) continue;
        const value = chineseToNumber(match[1]);
        if (!Number.isFinite(value) || value <= 0) continue;
        return { value, family, prefixLength: match[0].length, label: match[1] };
    }
    return null;
}

/** 去掉题目开头的顶层题号（只去一次），如 "1．有两根绳子" → "有两根绳子" */
export function stripQuestionNumber(text: string): string {
    const lines = text.split('\n');
    const first = lines[0]?.replace(LEADING_SPACE, '') ?? '';
    const match = matchQuestionNumber(first);
    if (match && match.family !== 'cn') lines[0] = first.slice(match.prefixLength);
    return lines.join('\n');
}

/** 统一换行、去掉行首缩进与行尾空白 */
export function normalizeLines(text: string): string[] {
    return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(LEADING_SPACE, '').replace(/[\s　]+$/, ''));
}

/** 送给 AI 分题的行：统一换行、去掉缩进，连续空行压成一个（行号按此编号） */
export function compactLines(text: string): string[] {
    const result: string[] = [];
    for (const line of normalizeLines(text)) {
        if (!line && (result.length === 0 || result[result.length - 1] === '')) continue;
        result.push(line);
    }
    while (result.length > 0 && result[result.length - 1] === '') result.pop();
    return result;
}

/** 把若干行拼为正文：去掉首尾空行，连续空行压成一个 */
export function joinLines(lines: string[]): string {
    const result: string[] = [];
    for (const line of lines) {
        if (!line && (result.length === 0 || result[result.length - 1] === '')) continue;
        result.push(line);
    }
    while (result.length > 0 && result[result.length - 1] === '') result.pop();
    return result.join('\n');
}

const NOISE_PATTERN = /(姓名|班级|学号|日期|得分|分数|评分|考号|座位号|家长签字|用时|Name\s*[:：_]|Class\s*[:：_]|Date\s*[:：_]|Score\s*[:：_])|_{3,}|共\s*\d+\s*(道|题|小题)|做完|答案(见|在)|最后一页|满分\s*\d+\s*分/i;
const MATERIAL_PATTERN = /(阅读|材料|短文|文章|选文|诗歌|古诗|文言文|下[面列]的?(表格|图表|统计|信息)|根据.{0,20}(回答|完成)|passage|read the|according to the)/i;
const ANSWER_HEADING = /^(参考答案|答案与解析|答案|Answers?|Answer Key)\s*[:：]?$/i;
const SECTION_PATTERN = /^(第[一二三四五六七八九十]+(部分|大题|节)|(Part|Section)\s+[A-Z0-9IVX]+\b)/i;
const SECTION_KEYWORD = /(选择|填空|判断|计算|解答|应用|解决问题|操作|作图|阅读|写作|作文|综合|口算|听力|单项|完形|题)/;
/** 「完成 1～3 题」「回答第 6-8 题」「Questions 1-3」 */
const RANGE_PATTERN = /(\d{1,3})\s*[~～\-—–至到]\s*(\d{1,3})\s*(?:小?题|questions?)/i;
/** 引出小问的题干，如「完成下列小题：」「回答下列问题：」 */
const SUB_QUESTION_STEM = /(小问|小题|下列问题|以下问题|下列各题|下面各题|完成下列|回答下列|回答以下|following questions|answer the following)/i;

/** 首题之前或题组前的一段文字是否是公共材料 */
function isMaterial(paragraph: string): boolean {
    if (NOISE_PATTERN.test(paragraph) && paragraph.length < 80) return false;
    if (MATERIAL_PATTERN.test(paragraph)) return true;
    // 较长、成句的段落（如没有提示语的阅读短文）按材料保留，避免丢失
    return paragraph.length >= 80 && /[。！？.!?；;]/.test(paragraph);
}

/** 按空行把若干行分成段落 */
function paragraphs(lines: string[]): string[] {
    const result: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
        if (line) current.push(line);
        else if (current.length) {
            result.push(current.join('\n'));
            current = [];
        }
    }
    if (current.length) result.push(current.join('\n'));
    return result;
}

interface Candidate extends NumberMatch {
    line: number;
}

/** 从每个候选出发，取同一写法、编号逐个加一的最长序列；分组标题后允许重新从 1 开始 */
function longestChain(candidates: Candidate[], sectionLines: Set<number>): Candidate[] {
    let best: Candidate[] = [];
    for (let start = 0; start < candidates.length; start++) {
        const first = candidates[start];
        const chain: Candidate[] = [first];
        for (let index = start + 1; index < candidates.length; index++) {
            const candidate = candidates[index];
            const last = chain[chain.length - 1];
            if (candidate.family !== first.family) continue;
            const restarted = candidate.value === 1 && [...sectionLines].some((line) => line > last.line && line < candidate.line);
            if (candidate.value === last.value + 1 || restarted) chain.push(candidate);
        }
        if (chain.length > best.length) best = chain;
    }
    return best;
}

function isSectionLine(line: string, match: NumberMatch | null, chainFamily: NumberFamily | null): boolean {
    if (SECTION_PATTERN.test(line)) return true;
    // 有阿拉伯题号时，「一、选择题」这样的汉字序号是大题标题
    return !!match && match.family === 'cn' && chainFamily !== 'cn' && chainFamily !== null
        && (line.length <= 40 || SECTION_KEYWORD.test(line.slice(0, 20)));
}

/** 把一段文字中的材料范围解析为题号集合；没有写范围时返回 null（作用到本组结束） */
function materialRange(material: string): { from: number; to: number } | null {
    const match = material.match(RANGE_PATTERN);
    if (!match) return null;
    const from = Number(match[1]);
    const to = Number(match[2]);
    return from <= to ? { from, to } : null;
}

/** 本地规则分题 */
export function splitQuestionText(raw: string, options: TextSplitOptions = {}): TextSplitResult {
    const tooLong = raw.length > MAX_SPLIT_TEXT_LENGTH;
    const lines = normalizeLines(raw.slice(0, MAX_SPLIT_TEXT_LENGTH));
    const matches = lines.map((line) => (line ? matchQuestionNumber(line) : null));

    // 答案页之后的内容不参与分题
    let end = lines.length;
    for (let index = 0; index < lines.length; index++) {
        if (ANSWER_HEADING.test(lines[index])) {
            end = index;
            break;
        }
    }

    const arabic: Candidate[] = [];
    const chinese: Candidate[] = [];
    for (let index = 0; index < end; index++) {
        const match = matches[index];
        if (!match) continue;
        (match.family === 'cn' ? chinese : arabic).push({ ...match, line: index });
    }
    const sectionCandidates = new Set<number>();
    for (let index = 0; index < end; index++) {
        if (SECTION_PATTERN.test(lines[index]) || matches[index]?.family === 'cn') sectionCandidates.add(index);
    }
    let chain = longestChain(arabic, sectionCandidates);
    if (chain.length < 2) {
        const cnChain = longestChain(chinese, new Set());
        if (cnChain.length >= 2) chain = cnChain;
    }

    const whole = joinLines(lines.slice(0, end));
    const ignoredTail = end < lines.length ? paragraphs(lines.slice(end)) : [];
    const single = (ambiguous: boolean): TextSplitResult => ({
        questions: whole ? [{ label: null, text: whole, material: null, section: null }] : [],
        ignored: ignoredTail, detected: false, ambiguous, candidateCount: ambiguous ? chain.length : whole ? 1 : 0, overflow: 0, tooLong,
    });
    if (chain.length < 2) return single(false);

    const chainFamily = chain[0].family;
    if (!options.forceNumbered && looksLikeSubQuestions(lines, chain[0].line, chainFamily, matches)) return single(true);
    const chainLines = new Set(chain.map((candidate) => candidate.line));
    const ignored: string[] = [];
    const questions: SplitTextQuestion[] = [];
    /** 当前分组的标题与尚待分配的材料 */
    let section: string | null = null;
    let pendingMaterials: Array<{ text: string; range: { from: number; to: number } | null }> = [];
    let materialsForSection: Array<{ text: string; range: { from: number; to: number } | null }> = [];

    /** 处理题目之间（或首题之前）的非题目内容 */
    const takeInterlude = (block: string[], beforeFirst: boolean) => {
        for (const paragraph of paragraphs(block)) {
            if (isMaterial(paragraph)) pendingMaterials.push({ text: paragraph, range: materialRange(paragraph) });
            else if (beforeFirst) ignored.push(paragraph);
            else if (section && !questions.some((question) => question.section === section)) section = `${section}\n${paragraph}`;
            else ignored.push(paragraph);
        }
    };

    const firstLine = chain[0].line;
    // 首题之前：分组标题、材料、标题/姓名栏
    const preamble: string[] = [];
    for (let index = 0; index < firstLine; index++) {
        if (lines[index] && isSectionLine(lines[index], matches[index], chainFamily)) {
            takeInterlude(preamble.splice(0), true);
            section = lines[index];
            materialsForSection = [];
        } else {
            preamble.push(lines[index]);
        }
    }
    takeInterlude(preamble, true);

    for (let position = 0; position < chain.length; position++) {
        const start = chain[position].line;
        const stop = position + 1 < chain.length ? chain[position + 1].line : end;
        // 新的材料从这一题起生效
        if (pendingMaterials.length) {
            materialsForSection = [...materialsForSection.filter((material) => material.range), ...pendingMaterials];
            pendingMaterials = [];
        }
        // 题目内部若出现分组标题，标题及其后的说明属于下一组
        let bodyEnd = stop;
        let nextSection: string | null = null;
        for (let index = start + 1; index < stop; index++) {
            if (lines[index] && !chainLines.has(index) && isSectionLine(lines[index], matches[index], chainFamily)) {
                bodyEnd = index;
                nextSection = lines[index];
                break;
            }
        }
        const body = lines.slice(start, bodyEnd);
        // 题目末尾、与正文隔着空行、以材料提示语开头的段落属于后面的题组
        const bodyParagraphs = paragraphs(body);
        const trailing: string[] = [];
        while (bodyParagraphs.length > 1 && MATERIAL_PATTERN.test(bodyParagraphs[bodyParagraphs.length - 1].slice(0, 30))) {
            trailing.unshift(bodyParagraphs.pop()!);
        }
        const text = trailing.length ? bodyParagraphs.join('\n') : joinLines(body);
        const value = chain[position].value;
        const applicable = materialsForSection.filter((material) => !material.range || (value >= material.range.from && value <= material.range.to));
        questions.push({
            label: chain[position].label,
            text: stripQuestionNumber(text),
            material: applicable.length ? applicable.map((material) => material.text).join('\n\n') : null,
            section,
        });
        for (const paragraph of trailing) pendingMaterials.push({ text: paragraph, range: materialRange(paragraph) });
        if (nextSection !== null) {
            section = nextSection;
            materialsForSection = [];
            takeInterlude(lines.slice(bodyEnd + 1, stop), false);
        }
    }
    // 超出上限的题不静默丢弃：原文列入未计入内容，并给出数量
    const overflow = questions.slice(MAX_SPLIT_QUESTIONS);
    return {
        questions: questions.slice(0, MAX_SPLIT_QUESTIONS),
        ignored: [...ignored, ...ignoredTail, ...overflow.map((question) => composeQuestionInput(question))],
        detected: true,
        ambiguous: false,
        candidateCount: questions.length,
        overflow: overflow.length,
        tooLong,
    };
}

/**
 * 编号前紧挨着一段题干时，编号很可能是这道题的小问：
 * - 题干后跟 1) 2) 这类括号编号（常见的小问写法）；
 * - 题干以冒号结尾并写明「完成下列小题」「回答下列问题」等。
 * 标题、姓名栏等说明不算题干；写明「完成 1～3 题」的阅读材料属于多道独立的题。
 */
function looksLikeSubQuestions(lines: string[], firstLine: number, family: NumberFamily, matches: Array<NumberMatch | null>): boolean {
    let stem: string | null = null;
    for (let index = firstLine - 1; index >= 0; index--) {
        if (!lines[index]) continue;
        stem = isSectionLine(lines[index], matches[index], family) ? null : lines[index];
        break;
    }
    if (!stem || NOISE_PATTERN.test(stem) || RANGE_PATTERN.test(stem)) return false;
    // 短标题（如「练习」）不算题干
    if (family === 'paren') return stem.length >= 15 || /[。？！?!：:，,；;]$/.test(stem);
    return /[：:]$/.test(stem) && SUB_QUESTION_STEM.test(stem);
}

/** 题目送去解析的完整文字：公共材料在前，题干在后 */
export function composeQuestionInput(question: Pick<SplitTextQuestion, 'text' | 'material'>): string {
    const text = question.text.trim();
    const material = question.material?.trim();
    return material ? `${material}\n\n${text}` : text;
}

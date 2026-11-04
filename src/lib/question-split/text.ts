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
    /** 题目正文（已去掉顶层题号与行首标记段落） */
    text: string;
    /** 公共材料（阅读材料、题组说明），解析时拼在题干前 */
    material: string | null;
    /** 所在大题的分组标题，如「一、选择题」，只用于显示 */
    section: string | null;
    /** 参考答案（识别自【答案】等行首标记） */
    answer?: string | null;
    /** 参考解析（识别自【解析】等行首标记，多个标记分段落合并） */
    analysis?: string | null;
    /** 知识点名称（识别自【知识点】等行首标记） */
    knowledgePoints?: string[];
    /** 难度星级（识别自【难度】等行首标记，1～5） */
    difficultyStars?: number | null;
    /** 题型（识别自【题型】等行首标记，question-type.ts 中的 key） */
    questionType?: string | null;
    /** 学生的错误作答（识别自【错答】等行首标记） */
    wrongAnswer?: string | null;
    /**
     * 本题在分题输入行数组中的范围（含首行题号行，不含下一题首行）。
     * 仅当调用方按行数组语义传入（如 PDF/DOCX 解析器）时有值；粘贴文字导入未填充。
     */
    lineRange?: { from: number; to: number };
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
    /**
     * 文字长度上限（默认 MAX_SPLIT_TEXT_LENGTH）。
     * 仅浏览器端本地分题可显式放大到 MAX_CLIENT_SPLIT_TEXT_LENGTH，服务端 createImportBatch 不传此参数
     */
    maxLength?: number;
    /**
     * 题数上限（默认 MAX_SPLIT_QUESTIONS）。
     * 仅浏览器端本地分题可显式放大到 MAX_CLIENT_SPLIT_QUESTIONS，服务端 createImportBatch 不传此参数
     */
    maxQuestions?: number;
}

/** 单次分题最多处理的文字长度与题数（服务端建批次的默认上限） */
export const MAX_SPLIT_TEXT_LENGTH = 20000;
export const MAX_SPLIT_QUESTIONS = 60;

/**
 * 客户端（浏览器端）本地分题的绝对上限：只在浏览器端分批时使用，
 * 服务端 createImportBatch 不得传入超过服务端默认值的参数
 */
export const MAX_CLIENT_SPLIT_TEXT_LENGTH = 1_000_000;
export const MAX_CLIENT_SPLIT_QUESTIONS = 2000;

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
    // 1. 1．（不把半角 1.5 这样的小数当题号；全角「．」是题号分隔符，后面紧跟数字（如 2．3×4=）也算题号）
    { family: 'dot', pattern: /^(\d{1,3})\s*(?:．|\.(?!\d))\s*/ },
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

/**
 * 判断一行是否是「短分组标题」：无题号、字数少、不像正文的一行（如「兴趣篇」「Part B」）。
 * 为避免把题干内的普通短句误判（如「练习」），要求以明确的结构词结尾（篇/章/节/部分/组）
 * 或为「Part X」「Section X」格式，且其后紧接新一段的 1 号题时才确认。
 */
function isShortSectionHeading(line: string, followingLines: string[] = []): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 12) return false;
    // 不以标点结尾（题号、句读、括号都不像标题）
    if (/[。！？!?,，、；;:：.．()（）【】\[\]{}]$/.test(trimmed)) return false;
    // 不含阿拉伯数字（题号）与编号标记
    if (/\d/.test(trimmed)) return false;
    // 不像正文：不含完整句子标点（题目正文通常有句读或较长）
    if (/[。！？!?；;，,]/.test(trimmed)) return false;
    // 必须以明确的结构词结尾或以「Part/Section X」格式出现，避免把普通短句（如「练习」）误判
    const isStructuralHeading = /(篇|章|节|部分|组)$/.test(trimmed) || /^(Part|Section)\s+[A-Z0-9]+$/i.test(trimmed);
    if (!isStructuralHeading) return false;
    // 其后必须紧接新一段从 1 开始的题号（跳过多行材料说明）
    if (followingLines.length) {
        return followingLines.some((next) => {
            const match = matchQuestionNumber(next);
            return match !== null && match.value === 1;
        });
    }
    return true;
}

/**
 * 从每个候选出发，取同一写法、编号逐个加一的最长序列；分组标题后允许重新从 1 开始。
 * 允许多段编号链：一条链结束后出现分组标题，之后同写法的题号重新从 1 开始递增时开启新段。
 */
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

/**
 * 把一条链按分组标题切成多段：每当题号回到 1 且前面有分组标题行时开启新段。
 * 返回各段链与段首的分组标题；单段时 sectionHeading 可能为 null（标题由主循环 preamble 处理）。
 */
function collectSegments(
    chain: Candidate[],
    allCandidates: Candidate[],
    lines: string[],
    matches: Array<NumberMatch | null>,
    sectionLines: Set<number>,
): Array<{ chain: Candidate[]; sectionHeading: string | null }> {
    if (chain.length < 2) return [];
    const family = chain[0].family;
    // 找出链中所有「题号从 1 开始」的位置（除第一个外）
    const segmentStarts: number[] = [0];
    for (let i = 1; i < chain.length; i++) {
        if (chain[i].value === 1) segmentStarts.push(i);
    }
    if (segmentStarts.length < 2) {
        // 单段：检测段首是否有短分组标题
        const heading = findHeadingBefore(chain[0].line, lines, matches, family, sectionLines);
        return heading !== null ? [{ chain, sectionHeading: heading }] : [];
    }
    // 验证每个分段点前面都有分组标题，否则不拆（保持原有单段行为）
    const segments: Array<{ chain: Candidate[]; sectionHeading: string | null }> = [];
    for (let s = 0; s < segmentStarts.length; s++) {
        const chainStart = segmentStarts[s];
        const chainEnd = s + 1 < segmentStarts.length ? segmentStarts[s + 1] : chain.length;
        const segmentChain = chain.slice(chainStart, chainEnd);
        const heading = s === 0
            ? findHeadingBefore(chain[0].line, lines, matches, family, sectionLines)
            : findHeadingBetween(chain[chainStart - 1].line, chain[chainStart].line, lines, matches, family, sectionLines);
        if (heading === null && s > 0) {
            // 分段点没有分组标题：不拆，把剩余部分并入前一段
            const lastSegment = segments[segments.length - 1];
            lastSegment.chain.push(...segmentChain);
            continue;
        }
        segments.push({ chain: segmentChain, sectionHeading: heading });
    }
    return segments.filter((segment) => segment.chain.length > 0);
}

/** 在一行之前找分组标题（向上扫描） */
function findHeadingBefore(
    lineIndex: number,
    lines: string[],
    matches: Array<NumberMatch | null>,
    family: NumberFamily,
    sectionLines: Set<number>,
): string | null {
    for (let i = lineIndex - 1; i >= 0; i--) {
        if (!lines[i]) continue;
        if (sectionLines.has(i) || isSectionLine(lines[i], matches[i], family) || isShortSectionHeading(lines[i])) {
            return lines[i];
        }
        // 遇到非空非标题行就停止（标题应紧挨题号）
        break;
    }
    return null;
}

/** 在两行之间找分组标题 */
function findHeadingBetween(
    afterLine: number,
    beforeLine: number,
    lines: string[],
    matches: Array<NumberMatch | null>,
    family: NumberFamily,
    sectionLines: Set<number>,
): string | null {
    for (let i = afterLine + 1; i < beforeLine; i++) {
        if (!lines[i]) continue;
        if (sectionLines.has(i) || isSectionLine(lines[i], matches[i], family) || isShortSectionHeading(lines[i])) {
            return lines[i];
        }
    }
    return null;
}

/**
 * 答案区也按段分组时，把答案区条目按段匹配到对应题目。
 * 返回未匹配的段落。
 */
function fillAnswersFromSegmentedTail(
    ignoredTail: string[],
    segments: Array<{ chain: Candidate[]; sectionHeading: string | null }>,
    questions: SplitTextQuestion[],
): string[] {
    const remaining: string[] = [];
    // 按段首题号在 questions 中的位置切分 questions
    let questionOffset = 0;
    const segmentQuestions: SplitTextQuestion[][] = segments.map((segment) => {
        const segmentQuestionsSlice = questions.slice(questionOffset, questionOffset + segment.chain.length);
        questionOffset += segment.chain.length;
        return segmentQuestionsSlice;
    });
    // 扫描 tail，按分组标题切段
    let currentSegmentIndex = -1;
    for (const paragraph of ignoredTail) {
        const paragraphLines = paragraph.split('\n');
        const unmatchedLines: string[] = [];
        let paragraphMatched = false;
        for (const line of paragraphLines) {
            const trimmed = line.trim();
            if (!trimmed) {
                unmatchedLines.push(line);
                continue;
            }
            // 检查是否是分组标题行
            const headingIndex = segments.findIndex((segment) => segment.sectionHeading && trimmed.includes(segment.sectionHeading));
            if (headingIndex >= 0) {
                currentSegmentIndex = headingIndex;
                continue;
            }
            const entries = parseAnswerLine(trimmed);
            if (!entries) {
                unmatchedLines.push(line);
                continue;
            }
            // 单段或找不到对应段时，尝试所有题
            const targetQuestions = currentSegmentIndex >= 0 ? segmentQuestions[currentSegmentIndex] : questions;
            let lineMatched = false;
            for (const entry of entries) {
                const target = targetQuestions.find((question) => question.label === entry.label);
                if (!target) {
                    unmatchedLines.push(line);
                    break;
                }
                lineMatched = true;
                paragraphMatched = true;
                const parsed = parseAnswerEntryContent(entry.text);
                if (parsed.answer && !target.answer) target.answer = parsed.answer;
                if (parsed.analysis) {
                    target.analysis = target.analysis ? `${target.analysis}\n${parsed.analysis}` : parsed.analysis;
                }
            }
            if (!lineMatched && !unmatchedLines.includes(line)) {
                unmatchedLines.push(line);
            }
        }
        if (!paragraphMatched) remaining.push(paragraph);
        else if (unmatchedLines.length) remaining.push(unmatchedLines.join('\n'));
    }
    return remaining;
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
    const maxLength = options.maxLength === undefined
        ? MAX_SPLIT_TEXT_LENGTH
        : Math.min(Math.max(options.maxLength, 1000), MAX_CLIENT_SPLIT_TEXT_LENGTH);
    const maxQuestions = options.maxQuestions === undefined
        ? MAX_SPLIT_QUESTIONS
        : Math.min(Math.max(options.maxQuestions, 2), MAX_CLIENT_SPLIT_QUESTIONS);
    const tooLong = raw.length > maxLength;
    const lines = normalizeLines(raw.slice(0, maxLength));
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
        if (SECTION_PATTERN.test(lines[index]) || matches[index]?.family === 'cn' || isShortSectionHeading(lines[index], lines.slice(index + 1, index + 5))) sectionCandidates.add(index);
    }
    // 多段编号链：段内同写法连续递增，段间由分组标题分隔且题号重新从 1 开始
    let segments: Array<{ chain: Candidate[]; sectionHeading: string | null }> = [];
    const initialChain = longestChain(arabic, sectionCandidates);
    if (initialChain.length < 2) {
        const cnChain = longestChain(chinese, new Set());
        if (cnChain.length >= 2) {
            segments = [{ chain: cnChain, sectionHeading: null }];
        }
    } else {
        segments = collectSegments(initialChain, arabic, lines, matches, sectionCandidates);
    }
    const chain = segments.length ? segments.flatMap((segment) => segment.chain) : initialChain;

    const whole = joinLines(lines.slice(0, end));
    const ignoredTail = end < lines.length ? paragraphs(lines.slice(end)) : [];
    /** 单题时取题干首行的题号作为 label，便于答案区条目按题号回填 */
    const singleLabel = (() => {
        const match = matchQuestionNumber(lines[chain[0]?.line ?? 0] ?? '');
        return match ? match.label : null;
    })();
    const single = (ambiguous: boolean): TextSplitResult => ({
        questions: whole ? [{ label: singleLabel, text: whole, material: null, section: null, lineRange: { from: 0, to: end } }] : [],
        ignored: ignoredTail, detected: false, ambiguous, candidateCount: ambiguous ? chain.length : whole ? 1 : 0, overflow: 0, tooLong,
    });
    if (chain.length < 2) {
        if (!whole) return single(false);
        // 单题时也识别行首标记（如整份答案粘进来作为一道题）
        const marked = extractMarkedFields(whole.split('\n'));
        const result = single(false);
        if (result.questions.length > 0 && Object.keys(marked.fields).length > 0) {
            result.questions[0] = { ...result.questions[0], text: stripQuestionNumber(marked.text), ...marked.fields };
        }
        // 单题时也尝试把答案区按题号回填（如「1. 2.5」「1-5：BCA」）
        if (result.questions.length > 0 && ignoredTail.length) {
            const [remaining, matchedAny] = fillAnswersFromTail(ignoredTail, result.questions);
            result.ignored = remaining;
            if (!matchedAny) result.ignored = ignoredTail;
        }
        return result;
    }

    const chainFamily = chain[0].family;
    if (!options.forceNumbered && looksLikeSubQuestions(lines, chain[0].line, chainFamily, matches)) {
        const ambiguousResult = single(true);
        if (ambiguousResult.questions.length > 0 && whole) {
            const marked = extractMarkedFields(whole.split('\n'));
            if (Object.keys(marked.fields).length > 0) {
                ambiguousResult.questions[0] = { ...ambiguousResult.questions[0], text: stripQuestionNumber(marked.text), ...marked.fields };
            }
        }
        return ambiguousResult;
    }
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
        if (lines[index] && (isSectionLine(lines[index], matches[index], chainFamily) || isShortSectionHeading(lines[index], lines.slice(index + 1, index + 5)))) {
            takeInterlude(preamble.splice(0), true);
            section = lines[index];
            materialsForSection = [];
        } else {
            preamble.push(lines[index]);
        }
    }
    takeInterlude(preamble, true);

    // 多段时各段的题号会重复，按题号回填会混淆；若答案区也按段分组则按段匹配，否则不回填
    const isMultiSegment = segments.length > 1;
    const segmentForPosition = (position: number): number => {
        if (!isMultiSegment) return -1;
        let count = 0;
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
            count += segments[segmentIndex].chain.length;
            if (position < count) return segmentIndex;
        }
        return segments.length - 1;
    };

    for (let position = 0; position < chain.length; position++) {
        const start = chain[position].line;
        const stop = position + 1 < chain.length ? chain[position + 1].line : end;
        // 新的一段开始时重置分组与材料
        const segmentIndex = segmentForPosition(position);
        if (isMultiSegment && segmentIndex >= 0) {
            const segmentHeading = segments[segmentIndex].sectionHeading;
            if (segmentHeading !== null) {
                section = segmentHeading;
                materialsForSection = [];
            }
        }
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
        const marked = extractMarkedFields(stripQuestionNumber(text).split('\n'));
        questions.push({
            label: chain[position].label,
            text: marked.text,
            material: applicable.length ? applicable.map((material) => material.text).join('\n\n') : null,
            section,
            lineRange: { from: start, to: stop },
            ...marked.fields,
        });
        for (const paragraph of trailing) pendingMaterials.push({ text: paragraph, range: materialRange(paragraph) });
        if (nextSection !== null) {
            section = nextSection;
            materialsForSection = [];
            takeInterlude(lines.slice(bodyEnd + 1, stop), false);
        }
    }
    // 答案区回填：单段时按题号匹配；多段时若答案区也按段分组（同样的分组标题后跟题号）则按段匹配，否则不回填并保留在 ignored
    let remainingIgnoredTail: string[];
    if (isMultiSegment && ignoredTail.length) {
        const sectionHeadings = segments.map((segment) => segment.sectionHeading).filter((heading): heading is string => heading !== null);
        const tailText = ignoredTail.join('\n');
        const tailHasGrouping = sectionHeadings.some((heading) => tailText.includes(heading));
        if (tailHasGrouping) {
            // 答案区也按段分组：把 tail 按分组标题切段，每段内按题号匹配到对应 segment 的题
            remainingIgnoredTail = fillAnswersFromSegmentedTail(ignoredTail, segments, questions);
        } else {
            // 答案区未按段分组：为避免题号重复混淆，不回填，全部保留在 ignored
            remainingIgnoredTail = ignoredTail;
        }
    } else {
        remainingIgnoredTail = fillAnswersFromTail(ignoredTail, questions)[0];
    }

    // 超出上限的题不静默丢弃：原文列入未计入内容，并给出数量
    const overflow = questions.slice(maxQuestions);
    return {
        questions: questions.slice(0, maxQuestions),
        ignored: [...ignored, ...remainingIgnoredTail, ...overflow.map((question) => composeQuestionInput(question))],
        detected: true,
        ambiguous: false,
        candidateCount: questions.length,
        overflow: overflow.length,
        tooLong,
    };
}

// ── 行首标记识别（答案、解析、知识点、难度、错答） ──────────────────────────

const MARK_PATTERNS = {
    answer: /^(?:【\s*(?:参考答案|答案)\s*】|(?:参考答案|答案)\s*[:：]|Answer\s*[:：])\s*(.*)$/i,
    analysis: /^(?:【\s*(?:解析|分析|详解|解答|点评)\s*】|(?:解析|分析|详解|解答|点评)\s*[:：])\s*(.*)$/,
    knowledge: /^(?:【\s*(?:知识点|考点)\s*】|(?:知识点|考点)\s*[:：])\s*(.*)$/,
    difficulty: /^(?:【\s*难度\s*】|难度\s*[:：])\s*(.*)$/,
    questionType: /^(?:【\s*题型\s*】|题型\s*[:：])\s*(.*)$/,
    wrongAnswer: /^(?:【\s*错答\s*】|我的答案\s*[:：]|学生答案\s*[:：])\s*(.*)$/,
} as const;

const DIFFICULTY_WORDS: Record<string, number> = { '易': 1, '较易': 2, '中等': 3, '较难': 4, '难': 5 };

/** 把难度文字解析为 1～5 的整数；无法识别时返回 null */
function parseDifficulty(raw: string): number | null {
    const text = raw.trim();
    if (!text) return null;
    const numeric = text.match(/^(\d{1,2})\s*(?:星|级)?$/);
    if (numeric) {
        const value = Number(numeric[1]);
        return value >= 1 && value <= 5 ? value : null;
    }
    if (/^[★☆]{1,5}$/.test(text)) {
        const filled = (text.match(/★/g) ?? []).length;
        return filled >= 1 ? filled : null;
    }
    if (text in DIFFICULTY_WORDS) return DIFFICULTY_WORDS[text];
    return null;
}

/** 把知识点文字按顿号、中英文逗号/分号拆成数组，去掉空项 */
function parseKnowledgePoints(raw: string): string[] {
    return raw.split(/[、，,；;]/).map((point) => point.trim()).filter(Boolean);
}

interface ParsedFields {
    answer?: string | null;
    analysis?: string | null;
    knowledgePoints?: string[];
    difficultyStars?: number | null;
    questionType?: string | null;
    wrongAnswer?: string | null;
}

/**
 * 识别一题内部的行首标记，把标记后的内容提取到对应字段并从题干中移除。
 * 无标记时返回空对象，题目文字原样保留。
 */
function extractMarkedFields(lines: string[]): { text: string; fields: ParsedFields } {
    type FieldKey = keyof typeof MARK_PATTERNS;
    const collected: Record<FieldKey, string[]> = { answer: [], analysis: [], knowledge: [], difficulty: [], questionType: [], wrongAnswer: [] };
    const body: string[] = [];
    let currentKey: FieldKey | null = null;

    for (const line of lines) {
        let matchedKey: FieldKey | null = null;
        for (const key of Object.keys(MARK_PATTERNS) as FieldKey[]) {
            const match = line.match(MARK_PATTERNS[key]);
            if (!match) continue;
            matchedKey = key;
            currentKey = key;
            const rest = match[1].trim();
            if (rest) collected[key].push(rest);
            break;
        }
        if (!matchedKey) {
            if (currentKey && line.trim()) {
                // 同一标记的后续行并入该字段
                collected[currentKey].push(line.trim());
            } else {
                body.push(line);
            }
        }
    }

    const fields: ParsedFields = {};
    const answer = collected.answer.join('\n').trim();
    if (answer) fields.answer = answer;
    const analysis = collected.analysis.join('\n').trim();
    if (analysis) fields.analysis = analysis;
    const knowledge = collected.knowledge.flatMap(parseKnowledgePoints);
    if (knowledge.length) fields.knowledgePoints = knowledge;
    const difficultyText = collected.difficulty.join(' ').trim();
    const difficulty = difficultyText ? parseDifficulty(difficultyText) : null;
    if (difficulty !== null) fields.difficultyStars = difficulty;
    const questionTypeText = collected.questionType.join(' ').trim();
    if (questionTypeText) fields.questionType = questionTypeText;
    const wrongAnswer = collected.wrongAnswer.join('\n').trim();
    if (wrongAnswer) fields.wrongAnswer = wrongAnswer;

    return { text: joinLines(body), fields };
}

/** 答案区条目：识别「1. B」「2．答案：12 解析：……」这类按题号列答案的写法（小数如「1. 2.5」的答案也接受） */
const ANSWER_ENTRY_PATTERN = /^(\d{1,3})\s*[.．、，,)]\s*(\S[\s\S]*)$/;
/** 一行多题片段里答案的最大长度；超过视为该段不是「短答案」，整行回退到单条解析 */
const MULTI_ENTRY_ANSWER_MAX_LENGTH = 30;

/** 区间写法：「1～5 BCADB」「1-5：BCADB」「1—5.BCADB」（连字符放字符类末尾避免被当作范围） */
const ANSWER_RANGE_PATTERN = /^(\d{1,3})\s*[~～—–-]\s*(\d{1,3})\s*[:：.．、]?\s*([A-Za-z]+)$/;

/** 把区间写法拆成多条（字母个数等于区间长度才逐题分配，否则返回 null） */
function parseAnswerRangeLine(line: string): Array<{ label: string; text: string }> | null {
    const match = line.trim().match(ANSWER_RANGE_PATTERN);
    if (!match) return null;
    const from = Number(match[1]);
    const to = Number(match[2]);
    const letters = match[3];
    if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= from || to - from + 1 > 60) return null;
    const width = to - from + 1;
    // 字母个数必须与区间长度一致，否则不按区间处理（保留在 ignored，由用户人工处理）
    if (letters.length !== width) return null;
    return Array.from({ length: width }, (_, index) => ({
        label: String(from + index),
        text: letters[index],
    }));
}

/**
 * 一行内多个「题号 + 短答案」片段：「1.B 2.C 3.A」「1．B　2．C」「1、A；2、D」。
 * 要求同一行 ≥2 个片段、每段答案 ≤30 字、不含完整句子标点；
 * 题号按递增顺序排列，但允许中间缺号（缺号的片段返回 null label，由调用方决定是否保留）。
 */
function parseMultiEntryLine(line: string): Array<{ label: string | null; text: string }> | null {
    const trimmed = line.trim();
    // 用「题号+分隔符」作锚点切分；分隔符集不含空格，空格留给答案内部
    const fragmentPattern = /(\d{1,3})\s*[.．、，,；;]\s*/g;
    const anchors: Array<{ index: number; label: string; afterIndex: number }> = [];
    for (const match of trimmed.matchAll(fragmentPattern)) {
        const index = match.index ?? 0;
        // 小数（如 2.5）不当题号：分隔符后紧跟数字时跳过
        const afterSeparator = trimmed[index + match[0].length];
        if (afterSeparator && /\d/.test(afterSeparator)) continue;
        anchors.push({ index, label: match[1], afterIndex: index + match[0].length });
    }
    if (anchors.length < 2) return null;
    // 题号必须严格递增
    for (let i = 1; i < anchors.length; i++) {
        if (Number(anchors[i].label) <= Number(anchors[i - 1].label)) return null;
    }
    const fragments: Array<{ label: string | null; text: string }> = [];
    for (let i = 0; i < anchors.length; i++) {
        const start = anchors[i].afterIndex;
        const end = i + 1 < anchors.length ? anchors[i + 1].index : trimmed.length;
        // 片段末尾可能残留「；;」等分隔符（如「1、A；2、D」中「A；」的「；」）
        const text = trimmed.slice(start, end).trim().replace(/[；;]+$/, '').trim();
        // 片段之间应仅靠空白或题号分隔；若包含完整句子标点则不像「一行多题」
        if (!text || text.length > MULTI_ENTRY_ANSWER_MAX_LENGTH) return null;
        if (/[。！？!?]/.test(text)) return null;
        fragments.push({ label: anchors[i].label, text });
    }
    return fragments;
}

/**
 * 解析答案区的一行：优先区间写法，其次一行多题，最后单条。
 * 返回 null 表示该行不是按题号的条目。
 */
function parseAnswerLine(line: string): Array<{ label: string; text: string }> | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const range = parseAnswerRangeLine(trimmed);
    if (range) return range;
    const multi = parseMultiEntryLine(trimmed);
    if (multi) return multi.map((entry) => ({ label: entry.label ?? '', text: entry.text })).filter((entry) => entry.label);
    const match = trimmed.match(ANSWER_ENTRY_PATTERN);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    return [{ label: match[1], text: match[2].trim() }];
}

/** 解析答案区条目的内容，识别其中的解析标记（如「答案：12 解析：因为…」） */
function parseAnswerEntryContent(text: string): { answer: string; analysis?: string } {
    const analysisMatch = text.match(/^(.*?)(?:【?\s*(?:解析|分析|详解|解答|点评)\s*】?\s*[:：])([\s\S]*)$/);
    if (analysisMatch) {
        const answer = analysisMatch[1].replace(/^(?:【?\s*(?:参考答案|答案)\s*】?\s*[:：])\s*/, '').trim();
        const analysis = analysisMatch[2].trim();
        return analysis ? { answer, analysis } : { answer: text.trim() };
    }
    const answer = text.replace(/^(?:【?\s*(?:参考答案|答案)\s*】?\s*[:：])\s*/, '').trim();
    return { answer: answer || text.trim() };
}

/**
 * 把答案区的段落按题号回填到对应题目：能匹配上的条目不再放入 ignored，匹配不上的留在 ignored。
 * 返回 [剩余 ignored 段落, 是否有任何条目被匹配]。
 */
function fillAnswersFromTail(ignoredTail: string[], questions: SplitTextQuestion[]): [string[], boolean] {
    const remaining: string[] = [];
    let matchedAny = false;
    for (const paragraph of ignoredTail) {
        const paragraphMatched = { value: false };
        const unmatchedLines: string[] = [];
        for (const line of paragraph.split('\n')) {
            const entries = line.trim() ? parseAnswerLine(line) : null;
            if (!entries) {
                if (line.trim()) unmatchedLines.push(line);
                continue;
            }
            let lineMatched = false;
            for (const entry of entries) {
                const target = questions.find((question) => question.label === entry.label);
                if (!target) {
                    unmatchedLines.push(line);
                    break;
                }
                lineMatched = true;
                paragraphMatched.value = true;
                const parsed = parseAnswerEntryContent(entry.text);
                if (parsed.answer && !target.answer) target.answer = parsed.answer;
                if (parsed.analysis) {
                    target.analysis = target.analysis ? `${target.analysis}\n${parsed.analysis}` : parsed.analysis;
                }
            }
            if (!lineMatched && !unmatchedLines.includes(line) && line.trim()) {
                // 整行没有任何条目匹配上时保留（此前 unmatchedLines 可能已含该行，避免重复）
                if (!unmatchedLines.includes(line)) unmatchedLines.push(line);
            }
        }
        matchedAny = matchedAny || paragraphMatched.value;
        // 段落里没有任何条目匹配上题目时，原样保留；有匹配时未匹配的零散行保留
        if (!paragraphMatched.value) remaining.push(paragraph);
        else if (unmatchedLines.length) remaining.push(unmatchedLines.join('\n'));
    }
    return [remaining, matchedAny];
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

/**
 * 题目送去解析的完整文字：公共材料在前，题干在后；自带答案/解析/错答时附在末尾供 AI 参考。
 * 小节标题固定为中文（「参考答案：」「参考解析：」「学生作答：」），AI 能理解，不做翻译。
 */
export function composeQuestionInput(question: Pick<SplitTextQuestion, 'text' | 'material' | 'answer' | 'analysis' | 'wrongAnswer'>): string {
    const text = question.text.trim();
    const material = question.material?.trim();
    const base = material ? `${material}\n\n${text}` : text;
    const sections: string[] = [];
    if (question.answer?.trim()) sections.push(`参考答案：${question.answer.trim()}`);
    if (question.analysis?.trim()) sections.push(`参考解析：${question.analysis.trim()}`);
    if (question.wrongAnswer?.trim()) sections.push(`学生作答：${question.wrongAnswer.trim()}`);
    if (!sections.length) return base;
    return `${base}\n\n${sections.join('\n\n')}`;
}

/**
 * AI 分题的输入、统一输出结构与校验，四个提供商共用。
 *
 * 模型输出不可信：
 * - 文字分题只接受行号范围，题目文字由服务端按行号从原文拼回，模型无法改写、遗漏或编造内容；
 *   越界、倒序、与其他题重叠的范围丢弃，没有归入任何题的非空行列入「未计入题目的内容」。
 * - 图片分题的区域按 0～1000 归一化坐标校验，越界裁到图片内，过小或无效的区域丢弃；没有可用区域的题标记为未定位，不猜测位置。
 * - JSON 被截断时只保留完整的题目并提示，没有任何有效题目时视为返回异常。
 */
import { z } from 'zod';
import { stripThinkingTags } from './schema';
import { joinLines, MAX_SPLIT_QUESTIONS, stripQuestionNumber } from '../question-split/text';
import type { DraftItemFlag, DraftRegion, DraftWarning } from '../question-split/draft';
import { MAX_ITEM_REGIONS, MIN_REGION_SIZE } from '../question-split/draft';

/** 文字分题最多发送的行数与总字数 */
export const MAX_SPLIT_LINES = 1000;
/** 图片分题中每题识别文字的上限（只用于预览辨认，解析时重新识别裁片） */
export const MAX_SPLIT_EXCERPT_LENGTH = 4000;

export type QuestionSplitInput =
    | { kind: 'text'; lines: string[]; language: 'zh' | 'en' }
    | { kind: 'image'; imageBase64: string; mimeType: string; language: 'zh' | 'en' };

export interface SplitQuestion {
    label: string | null;
    text: string;
    material: string | null;
    section: string | null;
    /** 图片分题的区域，相对坐标 0～1；文字分题为空 */
    regions: DraftRegion[];
    hasFigure: boolean;
    flags: DraftItemFlag[];
}

export interface QuestionSplitResult {
    questions: SplitQuestion[];
    ignored: string[];
    warnings: DraftWarning[];
}

const lineRange = z.tuple([z.coerce.number().int(), z.coerce.number().int()]);
const rawRegion = z.object({
    x: z.coerce.number(), y: z.coerce.number(),
    w: z.coerce.number(), h: z.coerce.number(),
});
const rawQuestion = z.object({
    label: z.union([z.string(), z.number()]).nullish(),
    lines: lineRange.nullish(),
    material: lineRange.nullish(),
    section: z.string().nullish(),
    text: z.string().nullish(),
    regions: z.array(z.unknown()).nullish(),
    hasFigure: z.boolean().nullish(),
    unclear: z.boolean().nullish(),
    partial: z.boolean().nullish(),
}).passthrough();
const rawResult = z.object({
    quality: z.string().nullish(),
    questions: z.array(z.unknown()),
});

/** 从被截断的 JSON 中取出 "questions" 数组里完整的对象 */
function salvageQuestions(text: string): unknown[] {
    const start = text.search(/"questions"\s*:\s*\[/);
    if (start === -1) return [];
    const objects: unknown[] = [];
    let index = text.indexOf('[', start) + 1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let objectStart = -1;
    for (; index < text.length; index++) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') {
            if (depth === 0) objectStart = index;
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth === 0 && objectStart !== -1) {
                try {
                    objects.push(JSON.parse(text.slice(objectStart, index + 1)));
                } catch {
                    // 跳过无法解析的对象
                }
                objectStart = -1;
            }
        } else if (char === ']' && depth === 0) break;
    }
    return objects;
}

/** 解析模型回复中的 JSON；被截断时尽量取回完整的题目 */
function readJson(text: string): { value: z.infer<typeof rawResult>; truncated: boolean } {
    let body = stripThinkingTags(text);
    const block = body.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (block) body = block[1];
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start !== -1 && end > start) {
        try {
            const parsed = rawResult.safeParse(JSON.parse(body.slice(start, end + 1)));
            if (parsed.success) return { value: parsed.data, truncated: false };
        } catch {
            // 继续尝试取回截断的内容
        }
    }
    const salvaged = salvageQuestions(body);
    if (salvaged.length === 0) throw new Error('AI_RESPONSE_ERROR: invalid question split output');
    return { value: { questions: salvaged }, truncated: true };
}

function cleanLabel(value: string | number | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const label = String(value).trim().replace(/[.．、:：)）]+$/, '').slice(0, 20);
    return label || null;
}

/** 0～1000 坐标转为 0～1，越界部分裁掉；无效或过小时返回 null */
export function normalizeSplitRegion(raw: unknown): DraftRegion | null {
    const parsed = rawRegion.safeParse(raw);
    if (!parsed.success) return null;
    const { x, y, w, h } = parsed.data;
    if (![x, y, w, h].every(Number.isFinite)) return null;
    const left = Math.max(0, Math.min(1000, x));
    const top = Math.max(0, Math.min(1000, y));
    const right = Math.max(0, Math.min(1000, x + w));
    const bottom = Math.max(0, Math.min(1000, y + h));
    const width = (right - left) / 1000;
    const height = (bottom - top) / 1000;
    if (width < MIN_REGION_SIZE || height < MIN_REGION_SIZE) return null;
    const round = (value: number) => Math.round(value * 10000) / 10000;
    return { x: round(left / 1000), y: round(top / 1000), width: round(width), height: round(height) };
}

function validRange(range: [number, number] | null | undefined, total: number): [number, number] | null {
    if (!range) return null;
    const [start, end] = range;
    return start >= 1 && end >= start && end <= total ? [start, end] : null;
}

function parseTextSplit(questions: unknown[], lines: string[]): QuestionSplitResult {
    const covered = new Array<boolean>(lines.length).fill(false);
    const taken: Array<[number, number]> = [];
    const materials: Array<[number, number] | null> = [];
    const result: SplitQuestion[] = [];
    for (const entry of questions) {
        const parsed = rawQuestion.safeParse(entry);
        if (!parsed.success) continue;
        const range = validRange(parsed.data.lines, lines.length);
        if (!range || taken.some(([start, end]) => range[0] <= end && range[1] >= start)) continue;
        const text = stripQuestionNumber(joinLines(lines.slice(range[0] - 1, range[1])));
        if (!text.trim()) continue;
        // 公共材料可以被多道题共同引用，但不能是这道题自己的题干
        const materialRange = validRange(parsed.data.material, lines.length);
        const usableMaterial = materialRange && (materialRange[1] < range[0] || materialRange[0] > range[1]) ? materialRange : null;
        taken.push(range);
        materials.push(usableMaterial);
        for (let index = range[0] - 1; index < range[1]; index++) covered[index] = true;
        if (usableMaterial) for (let index = usableMaterial[0] - 1; index < usableMaterial[1]; index++) covered[index] = true;
        result.push({
            label: cleanLabel(parsed.data.label),
            text,
            material: usableMaterial ? joinLines(lines.slice(usableMaterial[0] - 1, usableMaterial[1])) || null : null,
            section: parsed.data.section?.trim().slice(0, 500) || null,
            regions: [],
            hasFigure: false,
            flags: [],
        });
    }
    // 材料与任何一道题的题干重叠时不可信：去掉材料，题干原样保留
    materials.forEach((material, index) => {
        if (material && taken.some(([start, end]) => material[0] <= end && material[1] >= start)) result[index].material = null;
    });
    // 保持原文顺序
    const order = result.map((question, index) => ({ question, start: taken[index][0] })).sort((a, b) => a.start - b.start);
    const ignored: string[] = [];
    let current: string[] = [];
    for (let index = 0; index < lines.length; index++) {
        if (!covered[index] && lines[index].trim()) current.push(lines[index]);
        else if (current.length) {
            ignored.push(current.join('\n'));
            current = [];
        }
    }
    if (current.length) ignored.push(current.join('\n'));
    return { questions: order.map(({ question }) => question), ignored, warnings: [] };
}

function parseImageSplit(questions: unknown[], quality: string | null | undefined): QuestionSplitResult {
    const result: SplitQuestion[] = [];
    for (const entry of questions) {
        const parsed = rawQuestion.safeParse(entry);
        if (!parsed.success) continue;
        const text = (parsed.data.text || '').trim().slice(0, MAX_SPLIT_EXCERPT_LENGTH);
        const regions = (parsed.data.regions || []).map(normalizeSplitRegion).filter((region): region is DraftRegion => region !== null).slice(0, MAX_ITEM_REGIONS);
        if (!text && regions.length === 0) continue;
        const flags: DraftItemFlag[] = [];
        if (parsed.data.unclear) flags.push('unclear');
        if (parsed.data.partial) flags.push('partial');
        if (regions.length === 0) flags.push('unlocated');
        result.push({
            label: cleanLabel(parsed.data.label),
            text,
            material: null,
            section: parsed.data.section?.trim().slice(0, 500) || null,
            regions,
            hasFigure: parsed.data.hasFigure === true,
            flags,
        });
    }
    const warnings: DraftWarning[] = [];
    if (quality === 'blurry') warnings.push('blurry');
    if (quality === 'partial') warnings.push('partial');
    return { questions: result, ignored: [], warnings };
}

/**
 * 校验并规范化模型的分题回复。没有有效题目时返回空列表（由调用方提示「未识别到题目」）；
 * 回复无法解析时抛出 AI_RESPONSE_ERROR。
 */
export function parseQuestionSplit(text: string, input: QuestionSplitInput): QuestionSplitResult {
    const { value, truncated } = readJson(text);
    const parsed = input.kind === 'text'
        ? parseTextSplit(value.questions, input.lines)
        : parseImageSplit(value.questions, value.quality);
    const warnings = [...parsed.warnings];
    if (truncated) warnings.push('truncated');
    // 超出上限的题不静默丢弃：文字列入未计入内容并提示
    const overflow = parsed.questions.slice(MAX_SPLIT_QUESTIONS);
    if (overflow.length) warnings.push('tooMany');
    const ignored = [...parsed.ignored, ...overflow.map((question) => [question.material, question.text].filter(Boolean).join('\n\n')).filter(Boolean)];
    return { ...parsed, questions: parsed.questions.slice(0, MAX_SPLIT_QUESTIONS), ignored, warnings };
}

/** 供应商因模型不支持图片输入而拒绝请求 */
export function isImageUnsupportedError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return /(image|vision|multimodal|multi-modal|图片|图像|视觉|多模态)/.test(message)
        && /(not support|unsupported|does not accept|cannot|invalid content type|not allowed|不支持|无法处理)/.test(message);
}

/** 图片分题失败时的错误码：模型不支持图片时给出明确提示 */
export const AI_IMAGE_NOT_SUPPORTED = 'AI_IMAGE_NOT_SUPPORTED';

import { z } from 'zod';
import { sanitizeFigureSvg } from '../figure-svg';
import { parseRecognizedGrade } from '@/lib/question/question-grade';

/**
 * Zod schema for validating AI-parsed questions
 * Ensures type safety and business rule compliance
 */
export const ParsedQuestionSchema = z.object({
    questionText: z.string().min(1, "题目文本不能为空"),
    answerText: z.string().min(1, "答案不能为空"),
    analysis: z.string().min(1, "解析不能为空"),
    wrongAnswerText: z.string().optional().default(""),
    mistakeAnalysis: z.string().optional().default(""),
    mistakeStatus: z.enum(["not_attempted", "wrong_attempt", "unknown"]).optional().default("unknown"),
    subject: z.enum([
        "数学", "物理", "化学", "生物",
        "英语", "语文", "历史", "地理",
        "政治", "其他"
    ]),
    knowledgePoints: z.array(z.string()).max(5, "知识点最多 5 个"),
    requiresImage: z.boolean().optional().default(false), // 题目是否依赖图片（如几何题）
    difficultyStars: z.number().int().min(1).max(5).nullable().optional(), // 难度星级 1~5，AI 未给出时为空
    gradeSemester: z.string().max(100).nullable().optional(), // 题目年级学期，AI 无法判断时为空
    hasFigure: z.boolean().optional(), // 题目是否带配图
    figureSvg: z.string().nullable().optional(), // AI 重绘的 SVG 配图（已净化）
});

/**
 * Type inference from Zod schema
 * Use this type instead of manually defining ParsedQuestion
 */
export type ParsedQuestionFromSchema = z.infer<typeof ParsedQuestionSchema>;

/**
 * Validates and parses AI response JSON
 * @param data - Raw JSON data from AI
 * @returns Validated ParsedQuestion object
 * @throws ZodError if validation fails
 */
export function validateParsedQuestion(data: unknown): ParsedQuestionFromSchema {
    return ParsedQuestionSchema.parse(data);
}

/**
 * Safe validation that returns success/error object
 * @param data - Raw JSON data from AI
 */
export function safeParseParsedQuestion(data: unknown) {
    return ParsedQuestionSchema.safeParse(data);
}

/**
 * AI 掌握概率评估结果：probability 为 0~100 的百分数
 */
export const MasteryEvaluationSchema = z.object({
    probability: z.coerce.number().min(0).max(100),
    reason: z.string().trim().min(1).max(500),
});

/**
 * 过滤推理模型在回复文本中输出的 <think> / <thinking> 思考过程块
 */
export function stripThinkingTags(text: string): string {
    return text.replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1>/gi, '').trim();
}

/**
 * 从 AI 文本回复中提取 JSON 对象（兼容 markdown 代码块和前后多余文本）
 */
export function extractJsonObject(text: string): unknown {
    let jsonStr = stripThinkingTags(text);
    const blockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (blockMatch) {
        jsonStr = blockMatch[1].trim();
    }
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end > start) {
        jsonStr = jsonStr.substring(start, end + 1);
    }
    return JSON.parse(jsonStr);
}

/** 识别失败保留空年级，格式错误仍按 AI 返回异常处理。 */
export function parseGradeRecognition(text: string): string | null {
    const parsed = z.object({ gradeSemester: z.string().nullable() }).parse(extractJsonObject(text));
    return parseRecognizedGrade(parsed.gradeSemester);
}

export const AnswerGradingSchema = z.object({
    correct: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]),
    reason: z.string().trim().min(1).max(500),
});

/**
 * 解析 AI 判题回复
 */
export function parseAnswerGrading(text: string): { correct: boolean; reason: string } {
    return AnswerGradingSchema.parse(extractJsonObject(text));
}

/**
 * 解析 AI 掌握概率评估回复，返回 0~1 的概率
 */
export function parseMasteryEvaluation(text: string): { probability: number; reason: string } {
    const parsed = MasteryEvaluationSchema.parse(extractJsonObject(text));
    return {
        probability: Math.round(parsed.probability) / 100,
        reason: parsed.reason,
    };
}

/**
 * 规范化 AI 输出的学科名，不在学科列表内时返回 undefined
 */
export function normalizeSubject(value: string | null | undefined): ParsedQuestionFromSchema['subject'] | undefined {
    const parsed = ParsedQuestionSchema.shape.subject.safeParse(value?.trim());
    return parsed.success ? parsed.data : undefined;
}

/** 每题最多选取的知识点数量 */
export const MAX_KNOWLEDGE_TAGS = 5;

/** 难度星级范围 */
export const MIN_DIFFICULTY_STARS = 1;
export const MAX_DIFFICULTY_STARS = 5;

/**
 * 解析 AI 给出的难度星级（数字、"3"、"3 星"、"★★★" 均可），无法识别或越界时返回 null
 */
export function parseDifficultyStars(value: unknown): number | null {
    let stars: number;
    if (typeof value === 'number') {
        stars = value;
    } else if (typeof value === 'string') {
        const text = value.trim();
        const starCount = (text.match(/[★⭐]/gu) || []).length;
        const digits = text.match(/\d+(\.\d+)?/);
        stars = starCount > 0 && !digits ? starCount : digits ? Number(digits[0]) : NaN;
    } else {
        return null;
    }
    if (!Number.isFinite(stars)) return null;
    const rounded = Math.round(stars);
    return rounded >= MIN_DIFFICULTY_STARS && rounded <= MAX_DIFFICULTY_STARS ? rounded : null;
}

export interface TagSuggestionResult {
    tags: string[];
    difficultyStars: number | null;
}

/**
 * 解析 AI 选取的知识点（只保留可选清单中存在的标签，去重，最多 5 个）和难度星级
 */
export function parseTagSuggestion(text: string, allowedTags: string[]): TagSuggestionResult {
    const parsed = z.object({ tags: z.array(z.string()), difficultyStars: z.unknown().optional() }).parse(extractJsonObject(text));
    const allowed = new Set(allowedTags);
    const result: string[] = [];
    for (const tag of parsed.tags.map((value) => value.trim())) {
        if (allowed.has(tag) && !result.includes(tag)) {
            result.push(tag);
        }
    }
    return { tags: result.slice(0, MAX_KNOWLEDGE_TAGS), difficultyStars: parseDifficultyStars(parsed.difficultyStars) };
}

export interface FigureResult {
    hasFigure: boolean;
    figureSvg: string | null;
}

/**
 * 解析 AI 输出的 <has_figure> 与 <figure_svg>：SVG 经净化，无效时为空；
 * 画出了有效配图时视为有配图
 */
export function parseFigure(hasFigureRaw: string | null | undefined, figureSvgRaw: string | null | undefined): FigureResult {
    const figureSvg = sanitizeFigureSvg(figureSvgRaw);
    return { hasFigure: hasFigureRaw?.trim().toLowerCase() === 'true' || figureSvg !== null, figureSvg };
}

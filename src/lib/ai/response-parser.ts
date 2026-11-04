/**
 * 统一的 AI 回答解析工具
 *
 * 原先各提供商（OpenAI / Azure / Gemini / Anthropic）各自实现了一份
 * extractTag 与 parseResponse，行为存在差异，现收敛到本模块。
 *
 * 行为约定（以 OpenAI 版本为准，与各版本差异详见提交说明）：
 * - extractTag：analysis 标签缺少闭合标签（输出被截断）时读取到文本末尾，
 *   其余标签缺少闭合标签时返回 null
 * - parseQuestionResponse：返回 ParsedQuestion，必需标签缺失时抛错
 * - splitKnowledgePoints：按中英文逗号或换行切分知识点
 */
import type { ParsedQuestion } from "./types";
import {
    safeParseParsedQuestion,
    parseDifficultyStars,
    parseFigure,
    stripThinkingTags,
} from "./schema";
import { normalizeMistakeStatusForSave } from "@/lib/question/mistake-status";
import { parseRecognizedGrade } from "@/lib/question/question-grade";
import { createLogger } from "../logger";

const logger = createLogger('ai:response-parser');

export function extractTag(text: string, tagName: string): string | null {
    const cleaned = stripThinkingTags(text);
    const startTag = `<${tagName}>`;
    const endTag = `</${tagName}>`;
    const startIndex = cleaned.indexOf(startTag);

    // 如果找不到开始标签，返回 null
    if (startIndex === -1) {
        return null;
    }

    const contentStartIndex = startIndex + startTag.length;
    const endIndex = cleaned.lastIndexOf(endTag);

    // 特殊处理：如果闭合标签丢失（通常主要发生在最后的 analysis 标签被截断时）
    // 我们尝试读取到字符串末尾
    if (endIndex === -1 && tagName === 'analysis') {
        logger.warn({ tagName }, 'Tag was verified unclosed, treating as truncated and reading to end');
        return cleaned.substring(contentStartIndex).trim();
    }

    if (endIndex === -1 || contentStartIndex >= endIndex) {
        return null;
    }

    return cleaned.substring(contentStartIndex, endIndex).trim();
}

export function splitKnowledgePoints(raw: string | null | undefined): string[] {
    return (raw || '').split(/[,，\n]/).map(k => k.trim()).filter(k => k.length > 0);
}

export function parseQuestionResponse(text: string): ParsedQuestion {
    logger.debug({ textLength: text.length }, 'Parsing AI response');

    const questionText = extractTag(text, "question_text");
    const answerText = extractTag(text, "answer_text");
    const analysis = extractTag(text, "analysis");
    const subjectRaw = extractTag(text, "subject");
    const knowledgePointsRaw = extractTag(text, "knowledge_points");
    const requiresImageRaw = extractTag(text, "requires_image");
    const wrongAnswerText = extractTag(text, "wrong_answer_text") || "";
    const mistakeAnalysis = extractTag(text, "mistake_analysis") || "";
    const mistakeStatusRaw = extractTag(text, "mistake_status");

    // Basic Validation
    if (!questionText || !answerText || !analysis) {
        logger.error({ rawTextSample: text.substring(0, 500) }, 'Missing critical XML tags');
        throw new Error("Invalid AI response: Missing critical XML tags (<question_text>, <answer_text>, or <analysis>)");
    }

    // Process Subject
    let subject: ParsedQuestion['subject'] = '其他';
    const validSubjects: ParsedQuestion['subject'][] = ["数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"];
    if (subjectRaw && (validSubjects as string[]).includes(subjectRaw)) {
        subject = subjectRaw as ParsedQuestion['subject'];
    }

    // Process Knowledge Points
    const knowledgePoints = splitKnowledgePoints(knowledgePointsRaw);

    // Process requiresImage (default to false if not present or unrecognized)
    const requiresImage = requiresImageRaw?.toLowerCase().trim() === 'true';
    const mistakeStatus = normalizeMistakeStatusForSave(mistakeStatusRaw, wrongAnswerText);

    // Construct Result
    const result: ParsedQuestion = {
        questionText,
        answerText,
        analysis,
        wrongAnswerText,
        mistakeAnalysis,
        mistakeStatus,
        subject,
        knowledgePoints,
        requiresImage,
        gradeSemester: parseRecognizedGrade(extractTag(text, "grade_semester")),
        difficultyStars: parseDifficultyStars(extractTag(text, "difficulty_stars")),
        ...parseFigure(extractTag(text, "has_figure"), extractTag(text, "figure_svg")),
    };

    // Final Schema Validation (just to be safe, though likely compliant by now)
    const validation = safeParseParsedQuestion(result);
    if (validation.success) {
        logger.debug('Validated successfully via XML tags');
        return validation.data;
    } else {
        logger.warn({ validationError: validation.error.format() }, 'Schema validation warning');
        // We still return it as we trust our extraction more than the schema at this point
        return result;
    }
}

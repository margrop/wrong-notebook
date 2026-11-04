/**
 * 题目交换格式 JSON v1 的宽松解析器。
 * 设计目标：向前兼容、宽松解析、错误可定位。单题不合格不影响其余题目。
 * 不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import {
    MAX_ANALYSIS_LENGTH,
    MAX_FIGURE_SVG_LENGTH_EXCHANGE,
    MAX_IMAGE_DATA_URL_LENGTH,
    MAX_IMAGES_PER_QUESTION,
    MAX_KNOWLEDGE_POINT_LENGTH,
    MAX_KNOWLEDGE_POINTS,
    MAX_LABEL_LENGTH,
    MAX_MATERIAL_LENGTH,
    MAX_QUESTIONS_PER_FILE,
    MAX_QUESTION_TYPE_LENGTH,
    MAX_SECTION_LENGTH,
    MAX_GRADE_SEMESTER_LENGTH,
    MAX_SOURCE_LENGTH,
    MAX_SUBJECT_LENGTH,
    MAX_TEXT_LENGTH,
    QUESTION_FILE_FORMAT,
    QUESTION_FILE_VERSION,
} from "@/lib/question-format/schema";
import type { QuestionParseResult, StructuredQuestion } from "@/lib/question-format/types";

const WARNING_MISSING_FORMAT = "MISSING_FORMAT";
const WARNING_UNKNOWN_FORMAT = "UNKNOWN_FORMAT";
const WARNING_MISSING_VERSION = "MISSING_VERSION";
const WARNING_UNSUPPORTED_VERSION = "UNSUPPORTED_VERSION";
const WARNING_TRUNCATED = "TOO_MANY_QUESTIONS";

/** 整体错误（index 为 -1） */
const QUESTIONS_REQUIRED = "QUESTIONS_REQUIRED";
/** 题干为空或超长 */
const TEXT_REQUIRED = "TEXT_REQUIRED";
const TEXT_TOO_LONG = "TEXT_TOO_LONG";
const MATERIAL_TOO_LONG = "MATERIAL_TOO_LONG";
const SECTION_TOO_LONG = "SECTION_TOO_LONG";
const LABEL_TOO_LONG = "LABEL_TOO_LONG";
const ANSWER_TOO_LONG = "ANSWER_TOO_LONG";
const ANALYSIS_TOO_LONG = "ANALYSIS_TOO_LONG";
const INVALID_DIFFICULTY = "INVALID_DIFFICULTY";
const WRONG_ANSWER_TOO_LONG = "WRONG_ANSWER_TOO_LONG";
const SUBJECT_TOO_LONG = "SUBJECT_TOO_LONG";
const GRADE_SEMESTER_TOO_LONG = "GRADE_SEMESTER_TOO_LONG";
const SOURCE_TOO_LONG = "SOURCE_TOO_LONG";
const QUESTION_TYPE_TOO_LONG = "QUESTION_TYPE_TOO_LONG";
const KNOWLEDGE_POINT_TOO_LONG = "KNOWLEDGE_POINT_TOO_LONG";
const TOO_MANY_KNOWLEDGE_POINTS = "TOO_MANY_KNOWLEDGE_POINTS";
const INVALID_IMAGE_DATA_URL = "INVALID_IMAGE_DATA_URL";
const IMAGE_TOO_LARGE = "IMAGE_TOO_LARGE";
const TOO_MANY_IMAGES = "TOO_MANY_IMAGES";
const INVALID_QUESTION_SHAPE = "INVALID_QUESTION_SHAPE";

/** 知识点字符串分隔符：顿号、中英文逗号、中英文分号 */
const KNOWLEDGE_POINT_SPLITTER = /[、，,;；]/;

/** 可为空的字符串字段：空字符串视为缺省 */
function normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeKnowledgePoints(value: unknown): { points: string[] } | { error: string } {
    if (value === undefined || value === null) return { points: [] };
    const rawList: unknown[] = [];
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return { points: [] };
        rawList.push(...trimmed.split(KNOWLEDGE_POINT_SPLITTER));
    } else if (Array.isArray(value)) {
        rawList.push(...value);
    } else {
        return { error: INVALID_QUESTION_SHAPE };
    }
    const points: string[] = [];
    for (const item of rawList) {
        if (typeof item !== "string") return { error: INVALID_QUESTION_SHAPE };
        const trimmed = item.trim();
        if (!trimmed) continue;
        if (trimmed.length > MAX_KNOWLEDGE_POINT_LENGTH) return { error: KNOWLEDGE_POINT_TOO_LONG };
        points.push(trimmed);
    }
    if (points.length > MAX_KNOWLEDGE_POINTS) return { error: TOO_MANY_KNOWLEDGE_POINTS };
    return { points };
}

function normalizeDifficultyStars(value: unknown): { stars: number | undefined } | { error: string } {
    if (value === undefined || value === null || value === "") return { stars: undefined };
    let num: number;
    if (typeof value === "number") {
        num = value;
    } else if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return { stars: undefined };
        num = Number(trimmed);
    } else {
        return { error: INVALID_DIFFICULTY };
    }
    if (!Number.isInteger(num) || num < 1 || num > 5) return { error: INVALID_DIFFICULTY };
    return { stars: num };
}

interface ImageLike { dataUrl: string; alt?: string }

function normalizeImages(value: unknown): { images: ImageLike[] } | { error: string } {
    if (value === undefined || value === null) return { images: [] };
    if (!Array.isArray(value)) return { error: INVALID_QUESTION_SHAPE };
    if (value.length > MAX_IMAGES_PER_QUESTION) return { error: TOO_MANY_IMAGES };
    const images: ImageLike[] = [];
    for (const item of value) {
        if (typeof item !== "object" || item === null) return { error: INVALID_QUESTION_SHAPE };
        const record = item as Record<string, unknown>;
        const dataUrl = record.dataUrl;
        if (typeof dataUrl !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) {
            return { error: INVALID_IMAGE_DATA_URL };
        }
        if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
            return { error: IMAGE_TOO_LARGE };
        }
        const alt = normalizeOptionalString(record.alt);
        images.push(alt === undefined ? { dataUrl } : { dataUrl, alt });
    }
    return { images };
}

function checkMax(value: string | undefined, max: number, code: string): string | undefined {
    if (value !== undefined && value.length > max) return code;
    return undefined;
}

/** 校验并规范化单题；返回错误码或规范化结果 */
function normalizeQuestion(raw: unknown): { question: StructuredQuestion } | { error: string } {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return { error: INVALID_QUESTION_SHAPE };
    }
    const record = raw as Record<string, unknown>;

    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) return { error: TEXT_REQUIRED };
    if (text.length > MAX_TEXT_LENGTH) return { error: TEXT_TOO_LONG };

    const material = normalizeOptionalString(record.material);
    const materialError = checkMax(material, MAX_MATERIAL_LENGTH, MATERIAL_TOO_LONG);
    if (materialError) return { error: materialError };

    const section = normalizeOptionalString(record.section);
    const sectionError = checkMax(section, MAX_SECTION_LENGTH, SECTION_TOO_LONG);
    if (sectionError) return { error: sectionError };

    const label = normalizeOptionalString(record.label);
    const labelError = checkMax(label, MAX_LABEL_LENGTH, LABEL_TOO_LONG);
    if (labelError) return { error: labelError };

    const answer = normalizeOptionalString(record.answer);
    const answerError = checkMax(answer, MAX_TEXT_LENGTH, ANSWER_TOO_LONG);
    if (answerError) return { error: answerError };

    const analysis = normalizeOptionalString(record.analysis);
    const analysisError = checkMax(analysis, MAX_ANALYSIS_LENGTH, ANALYSIS_TOO_LONG);
    if (analysisError) return { error: analysisError };

    const wrongAnswer = normalizeOptionalString(record.wrongAnswer);
    const wrongAnswerError = checkMax(wrongAnswer, MAX_TEXT_LENGTH, WRONG_ANSWER_TOO_LONG);
    if (wrongAnswerError) return { error: wrongAnswerError };

    const subject = normalizeOptionalString(record.subject);
    const subjectError = checkMax(subject, MAX_SUBJECT_LENGTH, SUBJECT_TOO_LONG);
    if (subjectError) return { error: subjectError };

    const gradeSemester = normalizeOptionalString(record.gradeSemester);
    const gradeError = checkMax(gradeSemester, MAX_GRADE_SEMESTER_LENGTH, GRADE_SEMESTER_TOO_LONG);
    if (gradeError) return { error: gradeError };

    const source = normalizeOptionalString(record.source);
    const sourceError = checkMax(source, MAX_SOURCE_LENGTH, SOURCE_TOO_LONG);
    if (sourceError) return { error: sourceError };

    const questionType = normalizeOptionalString(record.questionType);
    const typeError = checkMax(questionType, MAX_QUESTION_TYPE_LENGTH, QUESTION_TYPE_TOO_LONG);
    if (typeError) return { error: typeError };

    const figureSvg = normalizeOptionalString(record.figureSvg);
    const figureSvgError = checkMax(figureSvg, MAX_FIGURE_SVG_LENGTH_EXCHANGE, "FIGURE_SVG_TOO_LONG");
    if (figureSvgError) return { error: figureSvgError };

    const knowledgePointsResult = normalizeKnowledgePoints(record.knowledgePoints);
    if ("error" in knowledgePointsResult) return { error: knowledgePointsResult.error };

    const difficultyResult = normalizeDifficultyStars(record.difficultyStars);
    if ("error" in difficultyResult) return { error: difficultyResult.error };

    const imagesResult = normalizeImages(record.images);
    if ("error" in imagesResult) return { error: imagesResult.error };

    const extensions =
        typeof record.extensions === "object" && record.extensions !== null && !Array.isArray(record.extensions)
            ? (record.extensions as Record<string, unknown>)
            : undefined;

    const question: StructuredQuestion = { text };
    if (material !== undefined) question.material = material;
    if (section !== undefined) question.section = section;
    if (label !== undefined) question.label = label;
    if (answer !== undefined) question.answer = answer;
    if (analysis !== undefined) question.analysis = analysis;
    if (knowledgePointsResult.points.length > 0) question.knowledgePoints = knowledgePointsResult.points;
    if (difficultyResult.stars !== undefined) question.difficultyStars = difficultyResult.stars;
    if (wrongAnswer !== undefined) question.wrongAnswer = wrongAnswer;
    if (subject !== undefined) question.subject = subject;
    if (gradeSemester !== undefined) question.gradeSemester = gradeSemester;
    if (source !== undefined) question.source = source;
    if (questionType !== undefined) question.questionType = questionType;
    if (figureSvg !== undefined) question.figureSvg = figureSvg;
    if (imagesResult.images.length > 0) question.images = imagesResult.images;
    if (extensions !== undefined) question.extensions = extensions;
    return { question };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 去掉只对题目交换格式文件有意义的警告（缺少 format / version）。
 * 其他格式的解析器（Word、PDF）复用 parseQuestionFile 做规范化时调用，避免向用户显示无关提示。
 */
export function withoutExchangeFormatWarnings(warnings: string[]): string[] {
    return warnings.filter((warning) => warning !== WARNING_MISSING_FORMAT && warning !== WARNING_MISSING_VERSION);
}

/**
 * 宽松解析题目交换文件。兼容三种输入形态：
 * 1. 规范对象 { format, version, questions }
 * 2. 裸题目数组（视为 questions）
 * 3. 缺 format/version 的对象（按 v1 尽力解析）
 * 单题不合格记入 errors（index 从 0 开始），其余题照常返回。
 */
export function parseQuestionFile(raw: unknown): QuestionParseResult {
    const errors: QuestionParseResult["errors"] = [];
    const warnings: string[] = [];
    let questionsRaw: unknown[] | null = null;

    if (Array.isArray(raw)) {
        questionsRaw = raw;
        warnings.push(WARNING_MISSING_FORMAT, WARNING_MISSING_VERSION);
    } else if (isObject(raw)) {
        const format = raw.format;
        const version = raw.version;
        if (format === undefined) {
            warnings.push(WARNING_MISSING_FORMAT);
        } else if (format !== QUESTION_FILE_FORMAT) {
            warnings.push(WARNING_UNKNOWN_FORMAT);
        }
        if (version === undefined) {
            warnings.push(WARNING_MISSING_VERSION);
        } else if (typeof version === "number" && version > QUESTION_FILE_VERSION) {
            warnings.push(WARNING_UNSUPPORTED_VERSION);
        }
        const candidate = raw.questions;
        if (Array.isArray(candidate)) {
            questionsRaw = candidate;
        } else {
            // questions 缺失或不是数组：整体错误
            return { questions: [], errors: [{ index: -1, reason: QUESTIONS_REQUIRED }], warnings };
        }
    } else {
        // 完全无法识别的根输入：整体错误
        return { questions: [], errors: [{ index: -1, reason: INVALID_QUESTION_SHAPE }], warnings };
    }

    let list = questionsRaw;
    if (list.length > MAX_QUESTIONS_PER_FILE) {
        warnings.push(WARNING_TRUNCATED);
        list = list.slice(0, MAX_QUESTIONS_PER_FILE);
    }

    const questions: StructuredQuestion[] = [];
    list.forEach((item, index) => {
        const result = normalizeQuestion(item);
        if ("error" in result) {
            errors.push({ index, reason: result.error });
        } else {
            questions.push(result.question);
        }
    });

    return { questions, errors, warnings };
}

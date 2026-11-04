/**
 * 题目交换格式 JSON v1 的 zod 定义（宽松校验版）。
 * 校验只负责「结构合法」，语义规范化（空白、分隔符、数字字符串）在 parse.ts 完成。
 * 不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import { z } from "zod";
import { MAX_FIGURE_SVG_LENGTH } from "@/lib/figure-svg";

/** 交换格式标识 */
export const QUESTION_FILE_FORMAT = "wrong-notebook-questions" as const;
/** 当前版本；新增字段不升版本，破坏性变化才升 */
export const QUESTION_FILE_VERSION = 1;

/** 单文件最多题目数 */
export const MAX_QUESTIONS_PER_FILE = 5000;
/** 题干/答案/错误答案长度上限，与现有题目上限一致 */
export const MAX_TEXT_LENGTH = 20000;
/** 解析长度上限 */
export const MAX_ANALYSIS_LENGTH = 50000;
/** 材料长度上限（与题干一致） */
export const MAX_MATERIAL_LENGTH = 20000;
/** 大题标题长度上限 */
export const MAX_SECTION_LENGTH = 500;
/** 题号长度上限 */
export const MAX_LABEL_LENGTH = 20;
/** 学科长度上限 */
export const MAX_SUBJECT_LENGTH = 100;
/** 年级学期长度上限 */
export const MAX_GRADE_SEMESTER_LENGTH = 100;
/** 来源长度上限 */
export const MAX_SOURCE_LENGTH = 200;
/** 题型长度上限 */
export const MAX_QUESTION_TYPE_LENGTH = 100;
/** 单个知识点长度上限 */
export const MAX_KNOWLEDGE_POINT_LENGTH = 200;
/** 单题知识点数量上限 */
export const MAX_KNOWLEDGE_POINTS = 100;
/** 单题图片数量上限 */
export const MAX_IMAGES_PER_QUESTION = 10;
/** 单张图片 dataUrl 长度上限（约 5MB base64 文本），超出记 IMAGE_TOO_LARGE */
export const MAX_IMAGE_DATA_URL_LENGTH = 5 * 1024 * 1024;
/** 配图 SVG 长度上限，与 src/lib/figure-svg.ts 的 MAX_FIGURE_SVG_LENGTH 一致 */
export const MAX_FIGURE_SVG_LENGTH_EXCHANGE = MAX_FIGURE_SVG_LENGTH;

/** 图片 dataUrl 前缀白名单：仅允许 base64 内嵌的 PNG / JPEG / WebP */
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,/;

export const questionImageSchema = z.object({
    dataUrl: z.string().regex(IMAGE_DATA_URL_PATTERN, "INVALID_IMAGE_DATA_URL").max(MAX_IMAGE_DATA_URL_LENGTH, "IMAGE_TOO_LARGE"),
    alt: z.string().max(200).optional(),
});

/** 宽松单题 schema：text 必填，其余字段缺省即视为未提供；语义校验在 parse 阶段按错误码报告 */
export const structuredQuestionSchema = z.object({
    text: z.string().max(MAX_TEXT_LENGTH),
    material: z.string().max(MAX_MATERIAL_LENGTH).optional(),
    section: z.string().max(MAX_SECTION_LENGTH).optional(),
    label: z.string().max(MAX_LABEL_LENGTH).optional(),
    answer: z.string().max(MAX_TEXT_LENGTH).optional(),
    analysis: z.string().max(MAX_ANALYSIS_LENGTH).optional(),
    knowledgePoints: z.array(z.string().max(MAX_KNOWLEDGE_POINT_LENGTH)).max(MAX_KNOWLEDGE_POINTS).optional(),
    difficultyStars: z.number().int().min(1).max(5).optional(),
    wrongAnswer: z.string().max(MAX_TEXT_LENGTH).optional(),
    subject: z.string().max(MAX_SUBJECT_LENGTH).optional(),
    gradeSemester: z.string().max(MAX_GRADE_SEMESTER_LENGTH).optional(),
    source: z.string().max(MAX_SOURCE_LENGTH).optional(),
    questionType: z.string().max(MAX_QUESTION_TYPE_LENGTH).optional(),
    figureSvg: z.string().max(MAX_FIGURE_SVG_LENGTH_EXCHANGE).optional(),
    images: z.array(questionImageSchema).max(MAX_IMAGES_PER_QUESTION).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
});

/** 严格版文件 schema：用于「结构正确」场景的快速校验与类型导出 */
export const questionFileSchema = z.object({
    format: z.literal(QUESTION_FILE_FORMAT),
    version: z.literal(QUESTION_FILE_VERSION),
    exportedAt: z.string().optional(),
    generator: z.string().max(200).optional(),
    questions: z.array(structuredQuestionSchema).max(MAX_QUESTIONS_PER_FILE),
});

export type QuestionFileSchema = z.infer<typeof questionFileSchema>;
export type StructuredQuestionSchema = z.infer<typeof structuredQuestionSchema>;

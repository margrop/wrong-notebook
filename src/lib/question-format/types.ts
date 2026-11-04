/**
 * 题目交换格式 JSON v1 的结构化类型定义。
 * 不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */

/** 题目图片：仅支持 base64 内嵌的 PNG / JPEG / WebP */
export interface QuestionImage {
    dataUrl: string;
    alt?: string;
}

/** 结构化题目：交换格式中的单题表示（字段均已完成规范化） */
export interface StructuredQuestion {
    /** 题干（必填） */
    text: string;
    /** 公共材料 */
    material?: string;
    /** 大题标题（分节） */
    section?: string;
    /** 原题号 */
    label?: string;
    /** 答案 */
    answer?: string;
    /** 解析 */
    analysis?: string;
    /** 知识点标签列表 */
    knowledgePoints?: string[];
    /** 难度星级 1~5 */
    difficultyStars?: number;
    /** 学生的错误答案 */
    wrongAnswer?: string;
    /** 学科名称或 key（如「数学」或 math） */
    subject?: string;
    /** 年级学期 */
    gradeSemester?: string;
    /** 来源（如「2025 期中」） */
    source?: string;
    /** 题型（字符串，先原样保留） */
    questionType?: string;
    /** 配图 SVG */
    figureSvg?: string;
    /** 内嵌图片 */
    images?: QuestionImage[];
    /** 第三方扩展字段 */
    extensions?: Record<string, unknown>;
}

/** 题目交换文件顶层结构 */
export interface QuestionFile {
    format: "wrong-notebook-questions";
    version: 1;
    /** ISO 8601 导出时间 */
    exportedAt?: string;
    /** 生成器标识 */
    generator?: string;
    questions: StructuredQuestion[];
}

/** 解析错误的可定位记录：index 从 0 开始，reason 为稳定的英文错误码 */
export interface QuestionParseError {
    index: number;
    reason: string;
}

/** 解析结果：成功的题目 + 逐题错误 + 整体警告 */
export interface QuestionParseResult {
    questions: StructuredQuestion[];
    errors: QuestionParseError[];
    warnings: string[];
}

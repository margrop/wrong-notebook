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

/** PDF 检测出的图形元素（页面坐标，y 自下而上） */
export interface PdfDetectedGraphic {
    kind: "image" | "vector";
    rect: { x: number; y: number; width: number; height: number };
}

/** 解析结果：成功的题目 + 逐题错误 + 整体警告 */
export interface QuestionParseResult {
    questions: StructuredQuestion[];
    errors: QuestionParseError[];
    warnings: string[];
    /**
     * PDF 解析附加：每道题的版面区域段（与 questions 下标对应），
     * 用于按区域截图保存题目原图。非 PDF 解析器不设置该字段。
     */
    pdfRegions?: Array<Array<{ page: number; rect: { x: number; yTop: number; width: number; height: number } }> | null>;
    /**
     * PDF 解析附加：是否检测到图形元素（图片绘制或矢量路径），
     * 用于摘要页决定「题目原图」选项的默认值。非 PDF 解析器不设置。
     */
    pdfHasGraphics?: boolean;
    /**
     * PDF 解析附加：每页检测出的图形元素（下标 0 = 第 1 页）。
     * 用于「有图形的题」选项按题过滤。非 PDF 解析器不设置。
     */
    pdfPageGraphics?: PdfDetectedGraphic[][];
    /** PDF 解析附加：每页高度（pt，下标 0 = 第 1 页），供图形矩形坐标翻转 */
    pdfPageHeights?: number[];
}

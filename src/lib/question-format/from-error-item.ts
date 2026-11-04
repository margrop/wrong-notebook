/**
 * 将错题本中的 ErrorItem 映射为题目交换格式 JSON v1 的 StructuredQuestion。
 * 纯函数，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import { MAX_IMAGE_DATA_URL_LENGTH } from "@/lib/question-format/schema";
import type { StructuredQuestion } from "@/lib/question-format/types";

/** 导出时从 ErrorItem 读取的字段子集（由调用方按需求 select） */
export interface ErrorItemExportSource {
    id: string;
    questionText: string | null;
    answerText: string | null;
    analysis: string | null;
    wrongAnswerText: string | null;
    difficultyStars: number | null;
    questionType?: string | null;
    gradeSemester: string | null;
    source: string | null;
    figureSvg: string | null;
    originalImageUrl: string;
    subjectName: string | null;
    tags: { name: string }[];
}

/** 与 schema.ts 的图片前缀白名单保持一致 */
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,/;

/**
 * 将单个 ErrorItem 映射为交换格式题目。
 * 题干为空（null、undefined 或去空白后无内容）时返回 null，由调用方计数到 warnings。
 * includeImages 为 true 且 originalImageUrl 是合法 data URL 且不超上限时写入 images。
 */
export function fromErrorItem(item: ErrorItemExportSource, includeImages?: boolean): StructuredQuestion | null {
    const text = item.questionText;
    if (text === null || text === undefined || text.trim().length === 0) return null;

    const question: StructuredQuestion = { text };

    if (item.answerText) question.answer = item.answerText;
    if (item.analysis) question.analysis = item.analysis;
    if (item.wrongAnswerText) question.wrongAnswer = item.wrongAnswerText;
    if (item.difficultyStars !== null && item.difficultyStars !== undefined) question.difficultyStars = item.difficultyStars;
    if (item.questionType) question.questionType = item.questionType;
    if (item.subjectName) question.subject = item.subjectName;
    if (item.gradeSemester) question.gradeSemester = item.gradeSemester;
    if (item.source) question.source = item.source;
    if (item.figureSvg) question.figureSvg = item.figureSvg;
    if (item.tags.length > 0) question.knowledgePoints = item.tags.map((t) => t.name);

    if (includeImages && IMAGE_DATA_URL_PATTERN.test(item.originalImageUrl)
        && item.originalImageUrl.length <= MAX_IMAGE_DATA_URL_LENGTH) {
        question.images = [{ dataUrl: item.originalImageUrl }];
    }

    return question;
}

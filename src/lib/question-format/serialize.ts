/**
 * 题目交换格式 JSON v1 的序列化器。
 * 生成规范的 v1 文件对象（省略空字段），与 parse.ts 宽松解析构成往返闭环。
 * 不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import {
    QUESTION_FILE_FORMAT,
    QUESTION_FILE_VERSION,
} from "@/lib/question-format/schema";
import type { QuestionFile, StructuredQuestion } from "@/lib/question-format/types";

export interface SerializeMeta {
    /** 生成器标识（如应用名或版本） */
    generator?: string;
    /** 导出时间（ISO 8601）；缺省由调用方不传则不写入 */
    exportedAt?: string;
}

/** 拷贝题目并省略空字段，保证输出文件体积最小且往返一致 */
function toCleanQuestion(question: StructuredQuestion): StructuredQuestion {
    const clean: StructuredQuestion = { text: question.text };
    if (question.material !== undefined && question.material !== "") clean.material = question.material;
    if (question.section !== undefined && question.section !== "") clean.section = question.section;
    if (question.label !== undefined && question.label !== "") clean.label = question.label;
    if (question.answer !== undefined && question.answer !== "") clean.answer = question.answer;
    if (question.analysis !== undefined && question.analysis !== "") clean.analysis = question.analysis;
    if (question.knowledgePoints !== undefined && question.knowledgePoints.length > 0) {
        clean.knowledgePoints = question.knowledgePoints;
    }
    if (question.difficultyStars !== undefined) clean.difficultyStars = question.difficultyStars;
    if (question.wrongAnswer !== undefined && question.wrongAnswer !== "") clean.wrongAnswer = question.wrongAnswer;
    if (question.subject !== undefined && question.subject !== "") clean.subject = question.subject;
    if (question.gradeSemester !== undefined && question.gradeSemester !== "") clean.gradeSemester = question.gradeSemester;
    if (question.source !== undefined && question.source !== "") clean.source = question.source;
    if (question.questionType !== undefined && question.questionType !== "") clean.questionType = question.questionType;
    if (question.figureSvg !== undefined && question.figureSvg !== "") clean.figureSvg = question.figureSvg;
    if (question.images !== undefined && question.images.length > 0) clean.images = question.images;
    if (question.extensions !== undefined && Object.keys(question.extensions).length > 0) clean.extensions = question.extensions;
    return clean;
}

/** 生成规范的 v1 文件对象 */
export function serializeQuestions(items: StructuredQuestion[], meta?: SerializeMeta): QuestionFile {
    const file: QuestionFile = {
        format: QUESTION_FILE_FORMAT,
        version: QUESTION_FILE_VERSION,
        questions: items.map(toCleanQuestion),
    };
    if (meta?.exportedAt !== undefined && meta.exportedAt !== "") file.exportedAt = meta.exportedAt;
    if (meta?.generator !== undefined && meta.generator !== "") file.generator = meta.generator;
    return file;
}

/** 序列化为带 2 空格缩进的 JSON 字符串（便于人工查看与 diff） */
export function questionFileToJson(file: QuestionFile): string {
    return JSON.stringify(file, null, 2);
}

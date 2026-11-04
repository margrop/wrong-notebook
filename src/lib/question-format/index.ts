/**
 * 题目交换格式 JSON v1：对外交换题目的标准格式。
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
export {
    QUESTION_FILE_FORMAT,
    QUESTION_FILE_VERSION,
    MAX_QUESTIONS_PER_FILE,
    MAX_TEXT_LENGTH,
    MAX_ANALYSIS_LENGTH,
    MAX_MATERIAL_LENGTH,
    MAX_SECTION_LENGTH,
    MAX_LABEL_LENGTH,
    MAX_SUBJECT_LENGTH,
    MAX_GRADE_SEMESTER_LENGTH,
    MAX_SOURCE_LENGTH,
    MAX_QUESTION_TYPE_LENGTH,
    MAX_KNOWLEDGE_POINT_LENGTH,
    MAX_KNOWLEDGE_POINTS,
    MAX_IMAGES_PER_QUESTION,
    MAX_IMAGE_DATA_URL_LENGTH,
    MAX_FIGURE_SVG_LENGTH_EXCHANGE,
    questionFileSchema,
    structuredQuestionSchema,
    questionImageSchema,
} from "@/lib/question-format/schema";
export type { QuestionFileSchema, StructuredQuestionSchema } from "@/lib/question-format/schema";
export { parseQuestionFile } from "@/lib/question-format/parse";
export { serializeQuestions, questionFileToJson } from "@/lib/question-format/serialize";
export type { SerializeMeta } from "@/lib/question-format/serialize";
export type {
    QuestionFile,
    StructuredQuestion,
    QuestionImage,
    QuestionParseError,
    QuestionParseResult,
} from "@/lib/question-format/types";

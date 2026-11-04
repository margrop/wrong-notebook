/**
 * JSON 题库文件解析器（题目交换格式 v1）。
 * decodeTextFile 解码 → JSON.parse → parseQuestionFile 复用规范化与上限校验。
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import { decodeTextFile } from "@/lib/import/file-read";
import { parseQuestionFile } from "@/lib/question-format/parse";
import type { QuestionParseResult } from "@/lib/question-format/types";

/** JSON 语法错误（index 为 -1） */
export const ERROR_INVALID_JSON = "INVALID_JSON";

/**
 * 解析 .json 题库文件。
 * 语法错误返回单个 INVALID_JSON 错误，不解出任何题目。
 */
export async function parseJsonQuestionFile(buffer: ArrayBuffer): Promise<QuestionParseResult> {
    const { text } = decodeTextFile(buffer);
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return { questions: [], errors: [{ index: -1, reason: ERROR_INVALID_JSON }], warnings: [] };
    }
    return parseQuestionFile(data);
}

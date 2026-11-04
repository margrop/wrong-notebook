/**
 * .xlsx 题库文件解析器。
 * 读取所有工作表，逐表识别表头并解析；
 * 多表时若表内没有大题列，用工作表名作为大题（section）。
 * 可在浏览器（Blob/ArrayBuffer）和服务端（Buffer）使用。
 */
import { parseTableRows } from "@/lib/import/file-parsers/table";
import type { QuestionParseResult } from "@/lib/question-format/types";

/** 单个工作表的数据（read-excel-file 返回格式） */
interface SheetData {
    sheet: string;
    data: unknown[][];
}

/**
 * 解析 .xlsx 文件内容。
 * @param input Blob / ArrayBuffer（universal 入口仅支持这两种）
 */
export async function parseXlsxFile(input: Blob | ArrayBuffer): Promise<QuestionParseResult> {
    // 动态导入以兼容浏览器和服务端
    const { default: readExcelFile } = await import("read-excel-file/universal");

    const sheets = (await readExcelFile(input)) as SheetData[];

    const allQuestions: QuestionParseResult["questions"] = [];
    const allErrors: QuestionParseResult["errors"] = [];
    const allWarnings: string[] = [];
    let questionOffset = 0;

    for (const sheetData of sheets) {
        const rows = sheetData.data;
        // 空表跳过
        if (!rows || rows.length === 0) continue;

        // 判断表内是否有 section 列：通过 parseTableRows 的结果推断
        // 先解析一次，若结果中没有 section 且是多表场景，再补工作表名
        const hasSectionColumn = rows.some((row) => {
            const firstRowStr = row.map((c) => String(c ?? "").trim().toLowerCase());
            return firstRowStr.some((cell) => {
                const normalized = cell.replace(/[\s　]+/g, "");
                return normalized === "section" || normalized === "大题" || normalized === "题型分组";
            });
        });

        const result = parseTableRows(rows, sheets.length > 1 && !hasSectionColumn ? sheetData.sheet : undefined);

        // 调整错误的 index 为全局题号
        for (const err of result.errors) {
            allErrors.push({
                index: err.index === -1 ? -1 : err.index + questionOffset,
                reason: err.reason,
            });
        }

        allWarnings.push(...result.warnings.map((w) => `[${sheetData.sheet}] ${w}`));
        allQuestions.push(...result.questions);
        questionOffset += result.questions.length;
    }

    return {
        questions: allQuestions,
        errors: allErrors,
        warnings: allWarnings,
    };
}

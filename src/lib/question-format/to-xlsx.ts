/**
 * StructuredQuestion[] → .xlsx 导出转换器。
 * 列与导入模板 TEMPLATE_COLUMNS 完全一致（题干、选项A~D、答案、解析、知识点、难度、题型、学科、年级学期、来源、大题、题号），
 * 保证「导出 → 再导入」可往返：
 * - 选项从题干末尾按「A．xxx」行拆出到 选项A~D 列（与 table.ts 的拼接格式互逆）；
 * - 题型写中文显示名（导入端经别名表可还原为标准 key）；
 * - 知识点用「、」连接；难度写 1~5 数字；
 * - 图片不写入 Excel（导入端也不支持图片列）。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 * 工作表名固定为「题目」；首行冻结并加粗；列宽按内容类型设置。
 */
import type { StructuredQuestion } from "@/lib/question-format/types";
import { TEMPLATE_COLUMNS } from "@/lib/import/file-parsers/table-template";
import { QUESTION_TYPE_NAMES_ZH, normalizeQuestionType } from "@/lib/question/question-type";

/** 选项行前缀：与 table.ts 中「A．xxx」的拼接格式互逆 */
const OPTION_LINE_PATTERN = /^([A-F])\s*[.、．:：]\s*(.*)$/;

/** 选项标签（与 table.ts 的 OPTION_LABELS 对齐，最多 6 个） */
const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"] as const;

/** 列宽（单位：字符），与 TEMPLATE_COLUMNS 一一对应 */
const COLUMN_WIDTHS: number[] = [
    60, // 题干
    20, // 选项A
    20, // 选项B
    20, // 选项C
    20, // 选项D
    20, // 答案
    40, // 解析
    30, // 知识点
    8, // 难度
    12, // 题型
    10, // 学科
    14, // 年级学期
    16, // 来源
    16, // 大题
    8, // 题号
];

/** 从题干文本拆分出选项：返回 { text, options }，选项下标 0~5 */
export function splitOptionsFromText(text: string): { text: string; options: string[] } {
    const lines = text.split("\n");
    // 从题干末尾向前收集连续的选项行（跳过空行），再验证是否构成从 A 开始的连续块
    const collected: { labelIndex: number; value: string }[] = [];
    let bodyEnd = lines.length;

    let i = lines.length - 1;
    while (i >= 0) {
        const line = lines[i].trim();
        if (line === "") {
            i--;
            continue;
        }
        const match = line.match(OPTION_LINE_PATTERN);
        if (!match) break;
        const labelIndex = OPTION_LABELS.indexOf(match[1] as typeof OPTION_LABELS[number]);
        if (labelIndex === -1) break;
        collected.unshift({ labelIndex, value: match[2] });
        i--;
        bodyEnd = i + 1;
    }

    // 验证：必须从 A 开始、且标签连续递增（A、B、C…），避免误拆正文中孤立的「D．」行
    for (let k = 0; k < collected.length; k++) {
        if (collected[k].labelIndex !== k) {
            collected.length = 0;
            bodyEnd = lines.length;
            break;
        }
    }

    // 去掉正文与选项块之间的空行
    const bodyLines = lines.slice(0, bodyEnd);
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") {
        bodyLines.pop();
    }

    if (collected.length === 0) {
        return { text, options: [] };
    }
    return { text: bodyLines.join("\n"), options: collected.map((c) => c.value) };
}

/** 题型 → 中文显示名：能识别标准 key 或别名时用 QUESTION_TYPE_NAMES_ZH，否则原样保留 */
export function questionTypeDisplayName(questionType: string | undefined): string {
    if (!questionType) return "";
    const normalized = normalizeQuestionType(questionType);
    return normalized ? QUESTION_TYPE_NAMES_ZH[normalized] : questionType;
}

/** 难度 → 1~5 数字字符串 */
function difficultyToCell(difficultyStars: number | undefined): string {
    if (typeof difficultyStars !== "number") return "";
    if (!Number.isInteger(difficultyStars) || difficultyStars < 1 || difficultyStars > 5) return "";
    return String(difficultyStars);
}

/**
 * 把题目列表转换为与导入模板一致的二维表（首行为表头）。
 * 每个单元格为字符串；无值时为 ""。
 */
export function questionsToSheetRows(questions: StructuredQuestion[]): string[][] {
    const rows: string[][] = [TEMPLATE_COLUMNS.slice()];

    for (const q of questions) {
        const { text, options } = splitOptionsFromText(q.text ?? "");
        rows.push([
            text,
            options[0] ?? "",
            options[1] ?? "",
            options[2] ?? "",
            options[3] ?? "",
            q.answer ?? "",
            q.analysis ?? "",
            q.knowledgePoints?.length ? q.knowledgePoints.join("、") : "",
            difficultyToCell(q.difficultyStars),
            questionTypeDisplayName(q.questionType),
            q.subject ?? "",
            q.gradeSemester ?? "",
            q.source ?? "",
            q.section ?? "",
            q.label ?? "",
        ]);
    }

    return rows;
}

/**
 * 生成 write-excel-file 的单表参数（数据 + 工作表名 + 列宽 + 冻结首行）。
 * 浏览器与 Node（universal 入口）共用同一份配置，保证测试与线上输出一致。
 */
export function buildXlsxSheet(questions: StructuredQuestion[]): {
    data: { value: string; fontWeight?: "bold"; wrap: boolean }[][];
    sheet: string;
    columns: { width: number }[];
    stickyRowsCount: number;
} {
    const sheetData = questionsToSheetRows(questions);
    const headerRow = sheetData[0].map((value) => ({
        value,
        fontWeight: "bold" as const,
        wrap: true,
    }));
    const dataRows = sheetData.slice(1).map((row) =>
        row.map((value) => ({ value, wrap: true }))
    );
    return {
        data: [headerRow, ...dataRows],
        sheet: "题目",
        columns: COLUMN_WIDTHS.map((width) => ({ width })),
        stickyRowsCount: 1,
    };
}

/**
 * 生成 .xlsx Blob（浏览器环境）。
 * 单工作表「题目」，首行冻结并加粗；列宽见 COLUMN_WIDTHS。
 */
export async function buildQuestionsXlsx(questions: StructuredQuestion[]): Promise<Blob> {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    const { data, sheet, columns, stickyRowsCount } = buildXlsxSheet(questions);
    return writeExcelFile(data, { sheet, columns, stickyRowsCount }).toBlob();
}

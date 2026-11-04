/**
 * 表格行 → StructuredQuestion 的核心解析逻辑。
 * 与 xlsx / csv 无关，便于单元测试。
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import { parseQuestionFile } from "@/lib/question-format/parse";
import { QUESTION_FILE_FORMAT, QUESTION_FILE_VERSION } from "@/lib/question-format/schema";
import type { QuestionParseResult, StructuredQuestion } from "@/lib/question-format/types";

/** 列别名的归一化目标字段 */
type ColumnField =
    | "text"
    | "material"
    | "section"
    | "label"
    | "answer"
    | "analysis"
    | "knowledgePoints"
    | "difficultyStars"
    | "wrongAnswer"
    | "subject"
    | "gradeSemester"
    | "source"
    | "questionType"
    | "unknown";

/** 选项列：字段名 option_A ~ option_F */
const OPTION_PREFIX = "option_";
const MAX_OPTIONS = 6;
const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"] as const;

/**
 * 列名归一化：去掉空白、全角转半角、小写。
 * 同时把中文全角括号等常见变体统一。
 */
function normalizeColumnName(raw: string): string {
    let s = raw.trim().toLowerCase();
    // 全角 → 半角（仅处理常见字符）
    s = s.replace(/[　]/g, "");
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => {
        const code = ch.charCodeAt(0);
        if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
        return ch;
    });
    // 去掉所有空白字符（含中英文空格、制表符）
    s = s.replace(/[\s　]+/g, "");
    return s;
}

/** 别名映射表：归一化列名 → 字段名 */
const COLUMN_ALIAS_MAP: Record<string, ColumnField> = {
    // 题干
    "题干": "text",
    "题目": "text",
    "题目内容": "text",
    "题目文本": "text",
    "question": "text",
    "text": "text",
    "stem": "text",
    // 材料
    "材料": "material",
    "阅读材料": "material",
    "material": "material",
    // 大题
    "大题": "section",
    "题型分组": "section",
    "section": "section",
    // 题号
    "题号": "label",
    "序号": "label",
    "no": "label",
    "label": "label",
    "number": "label",
    // 答案
    "答案": "answer",
    "参考答案": "answer",
    "正确答案": "answer",
    "answer": "answer",
    // 解析
    "解析": "analysis",
    "答案解析": "analysis",
    "分析": "analysis",
    "详解": "analysis",
    "analysis": "analysis",
    "explanation": "analysis",
    // 知识点
    "知识点": "knowledgePoints",
    "考点": "knowledgePoints",
    "knowledge": "knowledgePoints",
    "knowledgepoints": "knowledgePoints",
    "tags": "knowledgePoints",
    // 难度
    "难度": "difficultyStars",
    "难度星级": "difficultyStars",
    "difficulty": "difficultyStars",
    "difficultystars": "difficultyStars",
    // 错答
    "错答": "wrongAnswer",
    "我的答案": "wrongAnswer",
    "学生答案": "wrongAnswer",
    "wronganswer": "wrongAnswer",
    // 学科
    "学科": "subject",
    "科目": "subject",
    "subject": "subject",
    // 年级
    "年级": "gradeSemester",
    "年级学期": "gradeSemester",
    "grade": "gradeSemester",
    "gradesemester": "gradeSemester",
    // 来源
    "来源": "source",
    "出处": "source",
    "source": "source",
    // 题型
    "题型": "questionType",
    "type": "questionType",
    "questiontype": "questionType",
};

/** 选项列名归一化：返回选项序号 0~5 或 null */
function matchOptionColumn(normalized: string): number | null {
    // 「选项A」「选项 A」「选择A」「choice a」等形式
    const prefixMatch = normalized.match(/^(?:选项|选择|choice|option)([a-f])$/);
    if (prefixMatch) return OPTION_LABELS.indexOf(prefixMatch[1].toUpperCase() as typeof OPTION_LABELS[number]);
    // 单独的字母列名「A」「B」…
    if (/^[a-f]$/.test(normalized)) return OPTION_LABELS.indexOf(normalized.toUpperCase() as typeof OPTION_LABELS[number]);
    return null;
}

/** 识别表头行：返回列映射，若无法识别题干列返回 null */
interface ColumnMapping {
    field: ColumnField | `option_${number}`;
    rawName: string;
}

function buildColumnMapping(headerRow: string[]): ColumnMapping[] | null {
    const mapping: ColumnMapping[] = [];
    let hasTextColumn = false;

    for (const rawCell of headerRow) {
        const cell = String(rawCell);
        const normalized = normalizeColumnName(cell);
        if (!normalized) {
            // 空表头：忽略此列
            continue;
        }

        const field = COLUMN_ALIAS_MAP[normalized];
        if (field) {
            if (field === "text") hasTextColumn = true;
            mapping.push({ field, rawName: cell });
            continue;
        }

        const optionIdx = matchOptionColumn(normalized);
        if (optionIdx !== null && optionIdx < MAX_OPTIONS) {
            mapping.push({ field: `${OPTION_PREFIX}${optionIdx}`, rawName: cell });
            continue;
        }

        // 无法识别的列：忽略，但记录警告
        mapping.push({ field: "unknown", rawName: cell });
    }

    return hasTextColumn ? mapping : null;
}

/** 单元格值统一转字符串 */
export function cellToString(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") {
        // 避免科学计数法：整数直接 toString，小数用 toPrecision 后再清理
        if (Number.isInteger(value)) return String(value);
        // 使用足够精度但不引入科学计数法
        return String(value);
    }
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value);
}

/** 难度映射：支持 1~5 数字、★ 个数、易/较难等文字、0~1 难度系数 */
function parseDifficultyStars(raw: string): number | null {
    const s = raw.trim();
    if (!s) return null;

    // ★ 个数
    const starMatch = s.match(/^([★☆]+)$/);
    if (starMatch) {
        const full = starMatch[1].split("").filter((c) => c === "★").length;
        return full >= 1 && full <= 5 ? full : null;
    }

    // 数字 1~5
    const num = Number(s);
    if (!Number.isNaN(num)) {
        if (num >= 1 && num <= 5 && Number.isInteger(num)) return num;
        // 0~1 难度系数映射：≥0.8→1、≥0.6→2、≥0.4→3、≥0.2→4、其余→5
        if (num >= 0 && num <= 1) {
            if (num >= 0.8) return 1;
            if (num >= 0.6) return 2;
            if (num >= 0.4) return 3;
            if (num >= 0.2) return 4;
            return 5;
        }
        return null;
    }

    // 中文难度文字
    const difficultyMap: Record<string, number> = {
        "易": 1,
        "较易": 2,
        "容易": 1,
        "中等": 3,
        "中": 3,
        "较难": 4,
        "难": 5,
        "困难": 5,
    };
    return difficultyMap[s] ?? null;
}

/** 已知字段（排除 unknown） */
type KnownColumnField = Exclude<ColumnField, "unknown">;

/** 从列映射和行数据提取单个字段值 */
function extractFieldValue(
    mapping: ColumnMapping[],
    row: unknown[],
    field: KnownColumnField,
): string {
    for (let i = 0; i < mapping.length; i++) {
        if (mapping[i].field === field) {
            const cell = row[i];
            return cellToString(cell).trim();
        }
    }
    return "";
}

/** 从行数据提取所有选项 */
function extractOptions(mapping: ColumnMapping[], row: unknown[]): string[] {
    const options: string[] = [];
    for (let i = 0; i < mapping.length; i++) {
        const field = mapping[i].field;
        if (typeof field === "string" && field.startsWith(OPTION_PREFIX)) {
            const idx = Number(field.slice(OPTION_PREFIX.length));
            const value = cellToString(row[i]).trim();
            if (value) {
                options[idx] = value;
            }
        }
    }
    // 紧凑化：去掉空洞
    return options.filter((v) => v !== undefined && v !== "");
}

/** 检查行是否完全为空 */
function isRowEmpty(row: unknown[]): boolean {
    return row.every((cell) => {
        const s = cellToString(cell).trim();
        return s === "";
    });
}

/**
 * 将表格数据解析为 StructuredQuestion 列表。
 * @param rows 二维数组，第一行（或前 5 行中第一个可识别行）为表头
 * @param defaultSection 可选默认大题名（用于 xlsx 多表时的工作表名）
 */
export function parseTableRows(
    rows: unknown[][],
    defaultSection?: string,
): QuestionParseResult {
    const warnings: string[] = [];
    const errors: QuestionParseResult["errors"] = [];

    if (!rows || rows.length === 0) {
        return { questions: [], errors: [{ index: -1, reason: "EMPTY_TABLE" }], warnings };
    }

    // 在前 5 行中找第一个能识别出题干列的行作为表头
    let headerIdx = -1;
    let columnMapping: ColumnMapping[] | null = null;
    const maxHeaderSearch = Math.min(5, rows.length);
    for (let i = 0; i < maxHeaderSearch; i++) {
        const candidate = buildColumnMapping(rows[i].map((c) => cellToString(c)));
        if (candidate) {
            headerIdx = i;
            columnMapping = candidate;
            break;
        }
    }

    if (headerIdx === -1 || !columnMapping) {
        return { questions: [], errors: [{ index: -1, reason: "TEXT_COLUMN_NOT_FOUND" }], warnings };
    }

    // 收集未知列警告
    const unknownCols = columnMapping.filter((m) => m.field === "unknown");
    for (const col of unknownCols) {
        warnings.push(`UNKNOWN_COLUMN:${col.rawName}`);
    }

    // 找选项列的最大序号（用于 A/B/C 前缀）
    let maxOptionIdx = -1;
    for (const m of columnMapping) {
        if (typeof m.field === "string" && m.field.startsWith(OPTION_PREFIX)) {
            maxOptionIdx = Math.max(maxOptionIdx, Number(m.field.slice(OPTION_PREFIX.length)));
        }
    }

    interface RawQuestion {
        raw: Record<string, unknown>;
        index: number;
    }

    const rawQuestions: RawQuestion[] = [];

    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        // 空行跳过
        if (isRowEmpty(row)) continue;

        const text = extractFieldValue(columnMapping, row, "text");
        if (!text) {
            // 题干为空但其他列有值
            errors.push({ index: i - headerIdx - 1, reason: `TEXT_REQUIRED:row=${i - headerIdx}` });
            continue;
        }

        const raw: Record<string, unknown> = { text };

        const material = extractFieldValue(columnMapping, row, "material");
        if (material) raw.material = material;

        const section = extractFieldValue(columnMapping, row, "section");
        if (section) {
            raw.section = section;
        } else if (defaultSection) {
            raw.section = defaultSection;
        }

        const label = extractFieldValue(columnMapping, row, "label");
        if (label) raw.label = label;

        const answer = extractFieldValue(columnMapping, row, "answer");
        if (answer) raw.answer = answer;

        const analysis = extractFieldValue(columnMapping, row, "analysis");
        if (analysis) raw.analysis = analysis;

        const knowledgeRaw = extractFieldValue(columnMapping, row, "knowledgePoints");
        if (knowledgeRaw) {
            raw.knowledgePoints = knowledgeRaw.split(/[、，,;；]/).map((s) => s.trim()).filter(Boolean);
        }

        const difficultyRaw = extractFieldValue(columnMapping, row, "difficultyStars");
        if (difficultyRaw) {
            const stars = parseDifficultyStars(difficultyRaw);
            if (stars !== null) {
                raw.difficultyStars = stars;
            }
            // 无法解析的难度值不报错，直接跳过（保持宽松）
        }

        const wrongAnswer = extractFieldValue(columnMapping, row, "wrongAnswer");
        if (wrongAnswer) raw.wrongAnswer = wrongAnswer;

        const subject = extractFieldValue(columnMapping, row, "subject");
        if (subject) raw.subject = subject;

        const gradeSemester = extractFieldValue(columnMapping, row, "gradeSemester");
        if (gradeSemester) raw.gradeSemester = gradeSemester;

        const source = extractFieldValue(columnMapping, row, "source");
        if (source) raw.source = source;

        const questionType = extractFieldValue(columnMapping, row, "questionType");
        if (questionType) raw.questionType = questionType;

        // 选项：按 A．xxx 格式追加到题干末尾
        const options = extractOptions(columnMapping, row);
        if (options.length > 0) {
            const optionLines = options.map((opt, idx) => {
                const label = OPTION_LABELS[idx] ?? String(idx + 1);
                return `${label}．${opt}`;
            });
            raw.text = `${text}\n${optionLines.join("\n")}`;
        }

        rawQuestions.push({ raw, index: i - headerIdx - 1 });
    }

    // 经 parseQuestionFile 规范化校验
    const parseResult = parseQuestionFile({
        format: QUESTION_FILE_FORMAT,
        version: QUESTION_FILE_VERSION,
        questions: rawQuestions.map((q) => q.raw),
    });

    // 把 parseQuestionFile 的 index（相对 rawQuestions 数组）映射回原始行号
    const mappedErrors = parseResult.errors.map((err) => {
        const rawQ = rawQuestions[err.index];
        return {
            index: rawQ ? rawQ.index : err.index,
            reason: err.reason,
        };
    });

    // 合并前面收集的行级错误
    const allErrors = [...errors, ...mappedErrors].sort((a, b) => a.index - b.index);

    return {
        questions: parseResult.questions as StructuredQuestion[],
        errors: allErrors,
        warnings: [...warnings, ...parseResult.warnings],
    };
}

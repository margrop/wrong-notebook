/**
 * RFC 4180 兼容的 CSV 解析器。
 * 支持引号字段、字段内换行、转义双引号、CRLF；
 * 支持逗号 / 分号 / 制表符自动识别分隔符。
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */

export interface CsvParseResult {
    rows: string[][];
    delimiter: "," | ";" | "\t";
}

/**
 * 解析 CSV 文本。
 * 自动识别分隔符（逗号、分号、制表符），兼容 RFC 4180 引号规则。
 */
export function parseCsvText(text: string): CsvParseResult {
    const delimiter = detectDelimiter(text);
    const rows = parseRows(text, delimiter);
    return { rows, delimiter };
}

/** 自动检测分隔符：取第一行（非空）中出现次数最多且 ≥2 的候选分隔符 */
function detectDelimiter(text: string): "," | ";" | "\t" {
    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    const candidates: Array<"," | ";" | "\t"> = [",", ";", "\t"];
    let best: "," | ";" | "\t" = ",";
    let bestCount = 0;
    for (const cand of candidates) {
        const count = firstLine.split(cand).length - 1;
        if (count > bestCount) {
            bestCount = count;
            best = cand;
        }
    }
    return best;
}

/** 按 RFC 4180 解析行 */
function parseRows(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = "";
    let inQuotes = false;
    let i = 0;

    // 去掉 BOM
    if (text.charCodeAt(0) === 0xfeff) {
        i = 1;
    }

    while (i < text.length) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    // 转义双引号
                    currentField += '"';
                    i += 2;
                } else {
                    // 结束引号
                    inQuotes = false;
                    i += 1;
                }
            } else {
                currentField += ch;
                i += 1;
            }
            continue;
        }

        if (ch === '"' && currentField === "") {
            // 字段开始引号
            inQuotes = true;
            i += 1;
            continue;
        }

        if (ch === delimiter) {
            currentRow.push(currentField);
            currentField = "";
            i += 1;
            continue;
        }

        if (ch === "\r") {
            // 兼容 CRLF
            if (text[i + 1] === "\n") {
                i += 1;
            }
            currentRow.push(currentField);
            currentField = "";
            rows.push(currentRow);
            currentRow = [];
            i += 1;
            continue;
        }

        if (ch === "\n") {
            currentRow.push(currentField);
            currentField = "";
            rows.push(currentRow);
            currentRow = [];
            i += 1;
            continue;
        }

        currentField += ch;
        i += 1;
    }

    // 收尾
    if (currentField !== "" || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    // 过滤完全为空的行
    return rows.filter((row) => row.some((cell) => cell.trim() !== ""));
}

/**
 * E2 任务专用辅助：生成 .xlsx / .csv 题库文件（内存 Buffer）。
 * 列名与 src/lib/import/file-parsers/table-template.ts 的 TEMPLATE_COLUMNS 保持一致。
 */
import writeExcelFile from 'write-excel-file/node';

/** 模板列（与 table-template.ts TEMPLATE_COLUMNS 一致） */
export const TEMPLATE_COLUMNS = [
    '题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析', '知识点', '难度', '题型', '学科', '年级学期', '来源', '大题', '题号',
] as const;

/** 生成 .xlsx 题库文件 Buffer */
export async function buildXlsxBuffer(rows: string[][]): Promise<Buffer> {
    const sheetData: (string | null)[][] = [TEMPLATE_COLUMNS as unknown as string[], ...rows];
    return writeExcelFile(sheetData).toBuffer();
}

/** CSV 字段转义（RFC 4180） */
function escapeCsvField(field: string): string {
    if (/[",\n\r]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
    return field;
}

/** 生成 CSV 文本（UTF-8 BOM） */
export function buildCsvText(rows: string[][]): string {
    const lines = [TEMPLATE_COLUMNS.map(escapeCsvField).join(',')];
    for (const row of rows) lines.push(row.map(escapeCsvField).join(','));
    return `﻿${lines.join('\r\n')}\r\n`;
}

/** 生成 CSV Buffer */
export function buildCsvBuffer(rows: string[][]): Buffer {
    return Buffer.from(buildCsvText(rows), 'utf8');
}

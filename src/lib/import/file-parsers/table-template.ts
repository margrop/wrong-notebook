/**
 * Excel / CSV 题库模板生成器。
 * 生成包含示例数据的模板文件，帮助用户了解正确的列名格式。
 * 可在浏览器和服务端使用。
 */

/** 模板列定义：中文表头 */
export const TEMPLATE_COLUMNS: string[] = [
    "题干",
    "选项A",
    "选项B",
    "选项C",
    "选项D",
    "答案",
    "解析",
    "知识点",
    "难度",
    "题型",
    "学科",
    "年级学期",
    "来源",
    "大题",
    "题号",
];

/** 模板示例数据行：一道选择题 + 一道带答案解析的填空题 */
export const TEMPLATE_EXAMPLE_ROWS: string[][] = [
    [
        "下列哪个选项是正确的？",
        "选项一",
        "选项二",
        "选项三",
        "选项四",
        "A",
        "这是解析内容。",
        "知识点一、知识点二",
        "3",
        "单选题",
        "数学",
        "七年级上学期",
        "2025 期中",
        "第一大题",
        "1",
    ],
    [
        "1+1=____。",
        "",
        "",
        "",
        "",
        "2",
        "基础加法运算。",
        "基础运算",
        "易",
        "填空题",
        "数学",
        "一年级上学期",
        "课堂练习",
        "第一大题",
        "2",
    ],
];

/**
 * 生成 .xlsx 模板 Blob（浏览器环境）。
 * 使用 write-excel-file 浏览器版生成。
 */
export async function buildXlsxTemplate(): Promise<Blob> {
    const { default: writeExcelFile } = await import("write-excel-file/browser");

    const sheetData: string[][] = [
        TEMPLATE_COLUMNS,
        ...TEMPLATE_EXAMPLE_ROWS,
    ];

    const blob = await writeExcelFile(sheetData).toBlob();
    return blob;
}

/**
 * 生成 CSV 模板字符串（UTF-8 BOM，兼容 Excel）。
 * 可直接用于下载或保存为文件。
 */
export function buildCsvTemplate(): string {
    const escapeCsvField = (field: string): string => {
        if (/[",\n\r]/.test(field)) {
            return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
    };

    const lines: string[] = [];
    lines.push(TEMPLATE_COLUMNS.map(escapeCsvField).join(","));
    for (const row of TEMPLATE_EXAMPLE_ROWS) {
        lines.push(row.map(escapeCsvField).join(","));
    }

    // 添加 UTF-8 BOM（\uFEFF）以兼容 Excel 打开中文
    return `\uFEFF${lines.join("\r\n")}\r\n`;
}

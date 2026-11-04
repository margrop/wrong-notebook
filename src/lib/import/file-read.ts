/**
 * 文件导入：类型识别与纯文本解码。
 * 浏览器与服务端通用的纯函数，不依赖 DOM 之外的 Node 模块。
 */

export type ImportFileTypeKey = "text";

export type ImportFileCategory = "text" | "doc" | "sheet" | "data" | "pdf";

export interface ImportFileTypeDef {
    key: ImportFileTypeKey;
    /** 支持的扩展名（含点，小写） */
    extensions: string[];
    /** 匹配的 MIME（小写；空数组表示不依赖 MIME） */
    mimeTypes: string[];
    /** 最大体积（字节） */
    maxBytes: number;
    category: ImportFileCategory;
}

/**
 * 可导入文件类型描述表。目前只有纯文本；后续任务会加入
 * docx / xlsx / csv / json / pdf，向此表追加条目即可。
 */
export const IMPORT_FILE_TYPES: readonly ImportFileTypeDef[] = [
    {
        key: "text",
        extensions: [".txt", ".md", ".markdown"],
        mimeTypes: ["text/plain", "text/markdown"],
        maxBytes: 2 * 1024 * 1024,
        category: "text",
    },
];

/** 按扩展名或 MIME 识别文件类型；都不匹配时返回 null */
export function detectImportFileType(name: string, mime: string): ImportFileTypeDef | null {
    const lowerName = name.toLowerCase();
    const lowerMime = mime.toLowerCase().trim();
    for (const def of IMPORT_FILE_TYPES) {
        if (def.extensions.some((ext) => lowerName.endsWith(ext))) return def;
    }
    if (lowerMime) {
        for (const def of IMPORT_FILE_TYPES) {
            if (def.mimeTypes.includes(lowerMime)) return def;
        }
    }
    return null;
}

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "gb18030";

export interface DecodedTextFile {
    text: string;
    encoding: TextEncoding;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

function startsWith(bytes: Uint8Array, bom: number[], offset = 0): boolean {
    if (bytes.length < bom.length + offset) return false;
    return bom.every((b, i) => bytes[offset + i] === b);
}

/**
 * 去掉 UTF-8 BOM 与 UTF-16 自带的 BOM/空字符，并统一换行为 \n。
 * UTF-16 解码结果本身不含 BOM 字符，但会有 \r\n 需要归一。
 */
function normalizeText(text: string): string {
    let result = text;
    if (result.charCodeAt(0) === 0xfeff) result = result.slice(1);
    // 单字节流被误按 UTF-16 解读时会留下大量 \0，这里兜底清理
    if (result.includes("\0")) result = result.replace(/\0/g, "");
    return result.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * 解码纯文本文件：识别 BOM；无 BOM 时先按 UTF-8（fatal）解码，
 * 失败回退 gb18030（兼容 GBK，覆盖中文 Windows 记事本常见编码）。
 */
export function decodeTextFile(buffer: ArrayBuffer): DecodedTextFile {
    const bytes = new Uint8Array(buffer);
    if (startsWith(bytes, UTF8_BOM)) {
        const text = new TextDecoder("utf-8").decode(bytes.subarray(UTF8_BOM.length));
        return { text: normalizeText(text), encoding: "utf-8" };
    }
    if (startsWith(bytes, UTF16LE_BOM)) {
        const text = new TextDecoder("utf-16le").decode(bytes.subarray(UTF16LE_BOM.length));
        return { text: normalizeText(text), encoding: "utf-16le" };
    }
    if (startsWith(bytes, UTF16BE_BOM)) {
        const text = new TextDecoder("utf-16be").decode(bytes.subarray(UTF16BE_BOM.length));
        return { text: normalizeText(text), encoding: "utf-16be" };
    }
    try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { text: normalizeText(text), encoding: "utf-8" };
    } catch {
        const text = new TextDecoder("gb18030").decode(bytes);
        return { text: normalizeText(text), encoding: "gb18030" };
    }
}

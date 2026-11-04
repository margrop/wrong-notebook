import { describe, expect, it } from "vitest";
import { IMPORT_FILE_TYPES, BANK_FILE_TYPES, TEXT_FILE_TYPES, acceptedExtensions, decodeTextFile, detectImportFileType } from "@/lib/import/file-read";

function bytesOf(...bytes: number[]): ArrayBuffer {
    return new Uint8Array(bytes).buffer;
}

function utf8Bytes(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("decodeTextFile", () => {
    it("解码 UTF-8 无 BOM，并统一换行为 \n", () => {
        const { text, encoding } = decodeTextFile(utf8Bytes("第一题\r\n第二题\r第三题"));
        expect(encoding).toBe("utf-8");
        expect(text).toBe("第一题\n第二题\n第三题");
    });

    it("解码 UTF-8 带 BOM，去掉 BOM", () => {
        const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
        const content = new TextEncoder().encode("你好");
        const buffer = new Uint8Array(bom.length + content.length);
        buffer.set(bom);
        buffer.set(content, bom.length);
        const { text, encoding } = decodeTextFile(buffer.buffer);
        expect(encoding).toBe("utf-8");
        expect(text).toBe("你好");
        expect(text.charCodeAt(0)).not.toBe(0xfeff);
    });

    it("解码 UTF-16LE 带 BOM", () => {
        // "ab" 的 UTF-16LE 字节序：61 00 62 00，前缀 FF FE
        const { text, encoding } = decodeTextFile(bytesOf(0xff, 0xfe, 0x61, 0x00, 0x62, 0x00));
        expect(encoding).toBe("utf-16le");
        expect(text).toBe("ab");
    });

    it("解码 UTF-16BE 带 BOM", () => {
        // "ab" 的 UTF-16BE 字节序：00 61 00 62，前缀 FE FF
        const { text, encoding } = decodeTextFile(bytesOf(0xfe, 0xff, 0x00, 0x61, 0x00, 0x62));
        expect(encoding).toBe("utf-16be");
        expect(text).toBe("ab");
    });

    it("GBK 编码的中文按 gb18030 解码", () => {
        // 「中」的 GBK 编码为 D6 D0；构造一段 UTF-8 解码必然失败的 GBK 字节
        const gbkBytes = bytesOf(0xd6, 0xd0, 0xce, 0xc4);
        const { text, encoding } = decodeTextFile(gbkBytes);
        expect(encoding).toBe("gb18030");
        expect(text).toBe("中文");
    });

    it("CRLF 与 CR 换行统一为 \n（UTF-16LE）", () => {
        // "a\r\nb\rc" 的 UTF-16LE
        const le = [0xff, 0xfe, 0x61, 0x00, 0x0d, 0x00, 0x0a, 0x00, 0x62, 0x00, 0x0d, 0x00, 0x63, 0x00];
        const { text } = decodeTextFile(bytesOf(...le));
        expect(text).toBe("a\nb\nc");
    });
});

describe("detectImportFileType", () => {
    it("按扩展名识别 txt / md / markdown", () => {
        for (const name of ["a.txt", "b.md", "c.markdown", "D.TXT"]) {
            expect(detectImportFileType(name, "")?.key).toBe("text");
        }
    });

    it("按 MIME 识别 text/plain 与 text/markdown", () => {
        expect(detectImportFileType("unknown", "text/plain")?.key).toBe("text");
        expect(detectImportFileType("unknown", "text/markdown")?.key).toBe("text");
    });

    it("识别 docx / xlsx / csv / json 题库文件类型", () => {
        expect(detectImportFileType("a.docx", "")?.key).toBe("docx");
        expect(detectImportFileType("a.doc", "")?.key).toBe("docx");
        expect(detectImportFileType("a.xlsx", "")?.key).toBe("xlsx");
        expect(detectImportFileType("a.csv", "")?.key).toBe("csv");
        expect(detectImportFileType("a.json", "")?.key).toBe("json");
        expect(detectImportFileType("a.json", "application/json")?.key).toBe("json");
    });

    it("不支持的扩展名与 MIME 返回 null", () => {
        expect(detectImportFileType("a.png", "image/png")).toBeNull();
        expect(detectImportFileType("a.zip", "application/zip")).toBeNull();
    });

    it("IMPORT_FILE_TYPES 中纯文本最大 2MB，题库文件有各自上限", () => {
        const text = IMPORT_FILE_TYPES.find((t) => t.key === "text");
        expect(text?.maxBytes).toBe(2 * 1024 * 1024);
        expect(IMPORT_FILE_TYPES.find((t) => t.key === "json")?.maxBytes).toBe(50 * 1024 * 1024);
        expect(IMPORT_FILE_TYPES.find((t) => t.key === "xlsx")?.maxBytes).toBe(20 * 1024 * 1024);
        expect(IMPORT_FILE_TYPES.find((t) => t.key === "csv")?.maxBytes).toBe(10 * 1024 * 1024);
        expect(IMPORT_FILE_TYPES.find((t) => t.key === "docx")?.maxBytes).toBe(50 * 1024 * 1024);
    });

    it("识别 pdf 类型：按扩展名与 MIME，上限 50MB，归入题库文件", () => {
        const pdf = IMPORT_FILE_TYPES.find((t) => t.key === "pdf");
        expect(pdf).toBeDefined();
        expect(pdf?.extensions).toEqual([".pdf"]);
        expect(pdf?.mimeTypes).toContain("application/pdf");
        expect(pdf?.maxBytes).toBe(50 * 1024 * 1024);
        expect(pdf?.category).toBe("pdf");
        expect(detectImportFileType("a.pdf", "")?.key).toBe("pdf");
        expect(detectImportFileType("a.pdf", "application/pdf")?.key).toBe("pdf");
        expect(detectImportFileType("a.PDF", "")?.key).toBe("pdf");
        // pdf 不在 TEXT_FILE_TYPES 中，但在 BANK_FILE_TYPES 中
        expect(TEXT_FILE_TYPES.some((t) => t.key === "pdf")).toBe(false);
        expect(BANK_FILE_TYPES.some((t) => t.key === "pdf")).toBe(true);
    });
});

describe('旧版 .doc 允许选择但不列为支持格式', () => {
    it('detectImportFileType 仍把 .doc 识别为 Word 类型，以便提示另存为 .docx', () => {
        expect(detectImportFileType('试卷.doc', '')?.key).toBe('docx');
    });

    it('题库文件类型的支持扩展名中不含 .doc，文件选择仍接受 .doc', () => {
        const listed = BANK_FILE_TYPES.flatMap((type) => type.extensions);
        expect(listed).not.toContain('.doc');
        expect(listed).toContain('.docx');
        const docx = BANK_FILE_TYPES.find((type) => type.key === 'docx')!;
        expect(acceptedExtensions(docx)).toEqual(['.docx', '.doc']);
    });
});

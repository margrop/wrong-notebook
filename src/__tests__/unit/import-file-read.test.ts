import { describe, expect, it } from "vitest";
import { IMPORT_FILE_TYPES, decodeTextFile, detectImportFileType } from "@/lib/import/file-read";

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

    it("不支持的扩展名与 MIME 返回 null", () => {
        expect(detectImportFileType("a.docx", "")).toBeNull();
        expect(detectImportFileType("a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBeNull();
        expect(detectImportFileType("a.png", "image/png")).toBeNull();
    });

    it("IMPORT_FILE_TYPES 中纯文本最大 2MB", () => {
        const text = IMPORT_FILE_TYPES.find((t) => t.key === "text");
        expect(text?.maxBytes).toBe(2 * 1024 * 1024);
    });
});

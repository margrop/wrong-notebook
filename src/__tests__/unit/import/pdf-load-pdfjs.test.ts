/**
 * pdfjs 浏览器端默认参数与 getDocument 调用的单元测试：
 * - getPdfjsDefaultParams 返回同源静态路径（/pdfjs/cmaps/、/pdfjs/standard_fonts/）与 cMapPacked: true；
 * - parsePdf 在浏览器端（未注入 pdfjs 时）调用 getDocument 传入这些参数；
 * - parsePdf 在注入 pdfjs（测试/Node 环境）时不带浏览器默认参数，由 options 控制。
 */
import { describe, expect, it, vi } from "vitest";
import { getPdfjsDefaultParams } from "@/lib/import/file-parsers/pdf/load-pdfjs";
import type { PdfjsModule } from "@/lib/import/file-parsers/pdf/load-pdfjs";
import { parsePdf } from "@/lib/import/file-parsers/pdf/parse";
import { makePdfBuffer } from "@/__tests__/helpers/pdf-fixture";

describe("getPdfjsDefaultParams", () => {
    it("返回同源静态路径与 cMapPacked", () => {
        const params = getPdfjsDefaultParams();
        expect(params.cMapUrl).toBe("/pdfjs/cmaps/");
        expect(params.cMapPacked).toBe(true);
        expect(params.standardFontDataUrl).toBe("/pdfjs/standard_fonts/");
    });
});

/** 构造捕获 getDocument 参数的 fake pdfjs 模块 */
function makeFakePdfjs(): { pdfjs: PdfjsModule; getDocumentMock: ReturnType<typeof vi.fn> } {
    const getDocumentMock = vi.fn(() => ({ promise: Promise.resolve(makeFakeDoc()) }));
    return {
        pdfjs: {
            getDocument: getDocumentMock as unknown as PdfjsModule["getDocument"],
            GlobalWorkerOptions: { workerSrc: "" },
            PDFWorker: class {} as unknown as PdfjsModule["PDFWorker"],
        },
        getDocumentMock,
    };
}

/** 最小可用的 PDF 文档代理 */
function makeFakeDoc() {
    return {
        numPages: 1,
        getPage: vi.fn(async () => ({
            getViewport: () => ({ width: 612, height: 792 }),
            getTextContent: async () => ({ items: [{ str: "1. What is 2+2?", transform: [1, 0, 0, 1, 72, 720], width: 100, height: 12 }] }),
            getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
        })),
        cleanup: vi.fn(async () => {}),
    };
}

describe("parsePdf：getDocument 参数", () => {
    it("注入 pdfjs 时传入 standardFontDataUrl 与 verbosity（Node/测试路径）", async () => {
        const { pdfjs, getDocumentMock } = makeFakePdfjs();
        const buffer = makePdfBuffer([{ lines: [{ text: "1. What is 2+2?", y: 72 }] }]);
        await parsePdf(buffer, { pdfjs, standardFontDataUrl: "file:///fonts/" });
        expect(getDocumentMock).toHaveBeenCalledTimes(1);
        const params = getDocumentMock.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(params.data).toBeInstanceOf(Uint8Array);
        expect(params.standardFontDataUrl).toBe("file:///fonts/");
        expect(params.verbosity).toBe(0);
        expect(params.cMapUrl).toBeUndefined();
    });

    it("注入 pdfjs 且未传 standardFontDataUrl 时只传 data 与 verbosity", async () => {
        const { pdfjs, getDocumentMock } = makeFakePdfjs();
        const buffer = makePdfBuffer([{ lines: [{ text: "1. What is 2+2?", y: 72 }] }]);
        await parsePdf(buffer, { pdfjs });
        const params = getDocumentMock.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(params.data).toBeInstanceOf(Uint8Array);
        expect(params.verbosity).toBe(0);
        expect(params.standardFontDataUrl).toBeUndefined();
        expect(params.cMapUrl).toBeUndefined();
    });
});

/**
 * useFileImport 文字版 PDF 题目原图截图分支测试：
 * - 解析结果含 pdfRegions/pdfHasGraphics 时摘要页显示「题目原图」选项；
 * - 默认「全部题」；选择「有图形的题」只给含图形的题截图；
 * - 选择「全部题」给所有题截图；
 * - 选择「不保存」不截图；
 * - 单题截图失败不阻断其他题，记录 warning。
 * 通过渲染 FileImportPanel 驱动真实 hook，注入 fake pdfjs 加载器与截图器。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileImportPanel } from "@/components/file-import/file-import-panel";
import { LanguageProvider } from "@/contexts/LanguageContext";
import type { QuestionParseResult } from "@/lib/question-format/types";
import type { PdfDocumentProxyLike } from "@/lib/import/file-parsers/pdf/render-pages";

vi.mock("@/lib/feedback", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: pushMock }),
}));

// 注入 fake pdfjs 加载器与截图器
const loadDocumentMock = vi.hoisted(() => vi.fn());
const captureQuestionMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/use-file-import", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/hooks/use-file-import")>();
    return {
        ...actual,
        useFileImport: (options: Parameters<typeof actual.useFileImport>[0]) =>
            actual.useFileImport({ ...options, pdfCaptureDeps: { loadDocument: loadDocumentMock, captureQuestion: captureQuestionMock } }),
    };
});

// 文字版 PDF 解析器：返回构造好的含 pdfRegions/pdfHasGraphics 的结果
const pdfParseResultRef = vi.hoisted(() => ({ value: null as QuestionParseResult | null }));
vi.mock("@/lib/import/file-parsers", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/import/file-parsers")>();
    const pdfParser = async () => {
        const result = pdfParseResultRef.value;
        if (!result) throw new Error("pdfParseResultRef not set");
        return result;
    };
    return {
        ...actual,
        FILE_PARSERS: { ...actual.FILE_PARSERS, pdf: pdfParser },
        getFileParser: (key: string) => (key === "pdf" ? pdfParser : actual.getFileParser(key as Parameters<typeof actual.getFileParser>[0])),
    };
});

const createStructuredImportBatchesMock = vi.hoisted(() =>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.fn(async (_items: unknown[], _options: unknown) => ({
        batches: [{ id: "b1" }],
        clientRequestIdPrefix: "sb-test",
        failures: [],
    })),
);
vi.mock("@/lib/import/structured-batches", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/import/structured-batches")>();
    return {
        ...actual,
        createStructuredImportBatches: createStructuredImportBatchesMock,
    };
});

// Node 环境没有 createImageBitmap：mock 图片解码与 canvas renderer，使图片合成阶段可运行
vi.mock("@/lib/import/question-images", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/import/question-images")>();
    return {
        ...actual,
        sourceImageFromDataUrl: vi.fn(async () => ({ source: {} as CanvasImageSource, width: 100, height: 100 })),
        createCanvasRenderer: vi.fn(() => ({
            renderSingle: vi.fn(async () => "data:image/jpeg;base64,rendered"),
            renderComposite: vi.fn(async () => "data:image/jpeg;base64,rendered"),
        })),
    };
});

vi.mock("@/components/notebook-selector", () => ({
    NotebookSelector: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <select
            data-testid="notebook-selector"
            value={value}
            onChange={(event) => onChange(event.target.value)}
        >
            <option value="">请选择</option>
            <option value="nb-1">数学错题本</option>
        </select>
    ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    pdfParseResultRef.value = null;
});

const render = (defaultNotebookId?: string) => act(async () => root.render(
    <LanguageProvider><FileImportPanel defaultNotebookId={defaultNotebookId} /></LanguageProvider>
));

async function pickPdfFile() {
    const file = new File(["%PDF-fake"], "text.pdf", { type: "application/pdf" });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/** 构造含 2 题、第 2 题有图形的解析结果 */
function makeParseResult(hasGraphics: boolean): QuestionParseResult {
    return {
        questions: [
            { text: "Question one text here" },
            { text: "Question two text here" },
        ],
        errors: [],
        warnings: ["PAGES:1"],
        pdfHasGraphics: hasGraphics,
        pdfRegions: [
            [{ page: 1, rect: { x: 0, yTop: 100, width: 612, height: 100 } }],
            [{ page: 1, rect: { x: 0, yTop: 300, width: 612, height: 100 } }],
        ],
        pdfPageGraphics: hasGraphics
            ? [[{ kind: "vector", rect: { x: 50, y: 400, width: 100, height: 50 } }], []]
            : [[], []],
        pdfPageHeights: [792],
    };
}

describe("FileImportPanel：文字版 PDF 题目原图选项", () => {
    it("含图形时摘要页显示「题目原图」选项，默认选中「全部题」", async () => {
        pdfParseResultRef.value = makeParseResult(true);
        await render();
        await pickPdfFile();
        expect(container.textContent).toContain("题目原图");
        const all = container.querySelector('[data-testid="pdf-image-option-all"]') as HTMLInputElement;
        expect(all.checked).toBe(true);
        const withGraphics = container.querySelector('[data-testid="pdf-image-option-with-graphics"]') as HTMLInputElement;
        expect(withGraphics.checked).toBe(false);
        const none = container.querySelector('[data-testid="pdf-image-option-none"]') as HTMLInputElement;
        expect(none.checked).toBe(false);
    });

    it("不含图形时仍默认「全部题」（保留原题样子），「有图形的题」禁用", async () => {
        pdfParseResultRef.value = makeParseResult(false);
        await render();
        await pickPdfFile();
        const withGraphics = container.querySelector('[data-testid="pdf-image-option-with-graphics"]') as HTMLInputElement;
        expect(withGraphics.disabled).toBe(true);
        const all = container.querySelector('[data-testid="pdf-image-option-all"]') as HTMLInputElement;
        expect(all.checked).toBe(true);
    });

    it("选择「有图形的题」只给第 2 题截图", async () => {
        pdfParseResultRef.value = makeParseResult(true);
        loadDocumentMock.mockResolvedValue({ numPages: 1, getPage: vi.fn(), cleanup: vi.fn() } as unknown as PdfDocumentProxyLike);
        captureQuestionMock.mockResolvedValue("data:image/jpeg;base64,captured");
        await render("nb-1");
        await pickPdfFile();
        const withGraphicsRadio = container.querySelector('[data-testid="pdf-image-option-with-graphics"]') as HTMLInputElement;
        await act(async () => withGraphicsRadio.click());
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("导入 2 道题"),
        ) as HTMLButtonElement;
        await act(async () => confirmButton.click());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        // 只有第 2 题（index 1）被截图
        expect(captureQuestionMock).toHaveBeenCalledTimes(1);
        expect(captureQuestionMock.mock.calls[0]?.[1]).toEqual([
            { page: 1, rect: { x: 0, yTop: 300, width: 612, height: 100 } },
        ]);
        // 创建批次时第 2 题有 image（经 mock renderer 合成）
        const items = createStructuredImportBatchesMock.mock.calls[0]?.[0] as Array<{ text: string; image?: string | null }>;
        expect(items[0].image ?? null).toBeNull();
        expect(items[1].image).toBe("data:image/jpeg;base64,rendered");
    });

    it("选择「全部题」给所有题截图", async () => {
        pdfParseResultRef.value = makeParseResult(true);
        loadDocumentMock.mockResolvedValue({ numPages: 1, getPage: vi.fn(), cleanup: vi.fn() } as unknown as PdfDocumentProxyLike);
        captureQuestionMock.mockResolvedValue("data:image/jpeg;base64,captured");
        await render("nb-1");
        await pickPdfFile();
        const allRadio = container.querySelector('[data-testid="pdf-image-option-all"]') as HTMLInputElement;
        await act(async () => allRadio.click());
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("导入 2 道题"),
        ) as HTMLButtonElement;
        await act(async () => confirmButton.click());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(captureQuestionMock).toHaveBeenCalledTimes(2);
        const items = createStructuredImportBatchesMock.mock.calls[0]?.[0] as Array<{ image?: string | null }>;
        expect(items[0].image).toBe("data:image/jpeg;base64,rendered");
        expect(items[1].image).toBe("data:image/jpeg;base64,rendered");
    });

    it("选择「不保存」不截图", async () => {
        pdfParseResultRef.value = makeParseResult(true);
        await render("nb-1");
        await pickPdfFile();
        const noneRadio = container.querySelector('[data-testid="pdf-image-option-none"]') as HTMLInputElement;
        await act(async () => noneRadio.click());
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("导入 2 道题"),
        ) as HTMLButtonElement;
        await act(async () => confirmButton.click());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(captureQuestionMock).not.toHaveBeenCalled();
        const items = createStructuredImportBatchesMock.mock.calls[0]?.[0] as Array<{ image?: string | null }>;
        expect(items[0].image ?? null).toBeNull();
        expect(items[1].image ?? null).toBeNull();
    });

    it("单题截图失败不阻断其他题，记录 warning", async () => {
        pdfParseResultRef.value = makeParseResult(true);
        loadDocumentMock.mockResolvedValue({ numPages: 1, getPage: vi.fn(), cleanup: vi.fn() } as unknown as PdfDocumentProxyLike);
        captureQuestionMock.mockRejectedValue(new Error("capture failed"));
        await render("nb-1");
        await pickPdfFile();
        const allRadio = container.querySelector('[data-testid="pdf-image-option-all"]') as HTMLInputElement;
        await act(async () => allRadio.click());
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("导入 2 道题"),
        ) as HTMLButtonElement;
        await act(async () => confirmButton.click());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        // 批次仍被创建
        expect(createStructuredImportBatchesMock).toHaveBeenCalled();
        const items = createStructuredImportBatchesMock.mock.calls[0]?.[0] as Array<{ image?: string | null }>;
        expect(items[0].image ?? null).toBeNull();
        expect(items[1].image ?? null).toBeNull();
    });
});

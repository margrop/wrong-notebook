/**
 * useFileImport 扫描版 PDF 分支测试：
 * - PDF_NO_TEXT_LAYER 时进入 scanned-pdf 阶段（不是死路）；
 * - 确认页码范围后逐页创建 image 批次并跳转（单批直达详情页，多批去导入中心）；
 * - 额度不足（429）的页给出提示，已创建的批次保留并正常跳转；
 * - 超过 20 页上限要求用户缩小范围（UI 校验）。
 * 通过渲染 FileImportPanel 驱动真实 hook，注入 fake 渲染器与批次创建函数；
 * pdf 解析器返回构造好的 PDF_NO_TEXT_LAYER 结果（Node 下无法真实跑 pdfjs）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileImportPanel } from "@/components/file-import/file-import-panel";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { makePdfBuffer } from "@/__tests__/helpers/pdf-fixture";
import type { RenderedPdfPage } from "@/lib/import/file-parsers/pdf/render-pages";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";

vi.mock("@/lib/feedback", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: pushMock }),
}));

// 注入 fake 渲染器与批次创建（通过 useFileImport 的 scannedPdfDeps 透传）
const renderPagesMock = vi.hoisted(() => vi.fn());
const createBatchesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/use-file-import", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/hooks/use-file-import")>();
    return {
        ...actual,
        useFileImport: (options: Parameters<typeof actual.useFileImport>[0]) =>
            actual.useFileImport({ ...options, scannedPdfDeps: { renderPages: renderPagesMock, createBatches: createBatchesMock } }),
    };
});

// pdf 解析器：Node 下无法真实跑 pdfjs（loadPdfjsBrowser 依赖 DOM worker），
// 这里让 pdf 类型的解析器返回构造好的扫描版结果（页数可调），其余类型保持原样。
// 注意同时替换 getFileParser：它内部引用模块级 FILE_PARSERS 常量，单换 FILE_PARSERS 导出不会影响它。
const scannedPdfPageCountRef = vi.hoisted(() => ({ value: 3 }));
vi.mock("@/lib/import/file-parsers", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/import/file-parsers")>();
    const pdfParser = async () => ({
        questions: [],
        errors: [{ index: -1, reason: "PDF_NO_TEXT_LAYER" }],
        warnings: [`PAGES:${scannedPdfPageCountRef.value}`],
    });
    return {
        ...actual,
        FILE_PARSERS: { ...actual.FILE_PARSERS, pdf: pdfParser },
        getFileParser: (key: string) => (key === "pdf" ? pdfParser : actual.getFileParser(key as Parameters<typeof actual.getFileParser>[0])),
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
    scannedPdfPageCountRef.value = 3;
});

const render = (defaultNotebookId?: string) => act(async () => root.render(
    <LanguageProvider><FileImportPanel defaultNotebookId={defaultNotebookId} /></LanguageProvider>
));

async function pickFile(file: File) {
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function pdfFile(): File {
    // 内容无所谓：pdf 解析器已 mock 为始终返回 PDF_NO_TEXT_LAYER
    const buffer = makePdfBuffer([{ lines: [{ text: "Hi", y: 72 }] }]);
    return new File([buffer], "scanned.pdf", { type: "application/pdf" });
}

function renderedPage(pageNumber: number): RenderedPdfPage {
    return { pageNumber, dataUrl: `data:image/jpeg;base64,P${pageNumber}`, width: 1000, height: 1500, bytes: 100 };
}

function batch(id: string): ImportBatchDetail {
    return { id } as unknown as ImportBatchDetail;
}

/** 在选择页直接触发 handleFile（绕过 accept 限制，因为测试环境的 file input accept 与 mock 类型可能不一致） */
async function pickPdfFile() {
    const file = pdfFile();
    await pickFile(file);
}

/** 用原生 setter 设置 input 值并触发 React onChange（React 受控组件需要绕过直接赋值） */
function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("FileImportPanel：扫描版 PDF", () => {
    it("解析结果为 PDF_NO_TEXT_LAYER 时显示扫描版视图而非死路错误", async () => {
        await render();
        await pickPdfFile();
        expect(container.querySelector('[data-testid="file-import-scanned-pdf"]')).not.toBeNull();
        expect(container.textContent).toContain("这是扫描版 PDF（共 3 页）");
        // 不提示「无法导入」类错误
        expect(toast.error).not.toHaveBeenCalled();
    });

    it("默认全部页，确认后逐页创建 image 批次；单批直达详情页", async () => {
        renderPagesMock.mockResolvedValue([renderedPage(1)]);
        createBatchesMock.mockResolvedValue({ successes: [{ pageNumber: 1, batch: batch("b1") }], failures: [] });
        await render("nb-1");
        await pickPdfFile();
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("转为图片并识别导入"),
        ) as HTMLButtonElement;
        expect(confirmButton.disabled).toBe(false);
        await act(async () => confirmButton.click());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        // 默认全部 3 页
        expect(renderPagesMock).toHaveBeenCalledTimes(1);
        const renderArgs = renderPagesMock.mock.calls[0];
        expect(renderArgs?.[1]).toEqual([1, 2, 3]);
        expect(createBatchesMock).toHaveBeenCalled();
        expect(pushMock).toHaveBeenCalledWith("/import-batches/b1");
    });

    it("页码范围 1-2 只渲染所选页；多批跳转到导入中心列表", async () => {
        renderPagesMock.mockResolvedValue([renderedPage(1), renderedPage(2)]);
        createBatchesMock.mockResolvedValue({
            successes: [
                { pageNumber: 1, batch: batch("b1") },
                { pageNumber: 2, batch: batch("b2") },
            ],
            failures: [],
        });
        await render("nb-1");
        await pickPdfFile();
        const rangeInput = container.querySelector("#scanned-pdf-range") as HTMLInputElement;
        act(() => setInputValue(rangeInput, "1-2"));
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("转为图片并识别导入"),
        ) as HTMLButtonElement;
        await act(async () => confirmButton.click());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(renderPagesMock).toHaveBeenCalledTimes(1);
        const renderArgs = renderPagesMock.mock.calls[0];
        expect(renderArgs?.[1]).toEqual([1, 2]);
        expect(pushMock).toHaveBeenCalledWith("/import-tasks");
    });

    it("超出 20 页上限时提示缩小范围，不触发渲染", async () => {
        await render("nb-1");
        // mock 解析器返回 25 页
        scannedPdfPageCountRef.value = 25;
        await pickPdfFile();
        expect(container.textContent).toContain("共 25 页");
        const rangeInput = container.querySelector("#scanned-pdf-range") as HTMLInputElement;
        act(() => setInputValue(rangeInput, "1-25"));
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("转为图片并识别导入"),
        ) as HTMLButtonElement;
        await act(async () => confirmButton.click());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(container.textContent).toContain("页码范围无效");
        expect(renderPagesMock).not.toHaveBeenCalled();
    });

    it("额度不足的页提示并保留已创建的批次，仍跳转到导入中心", async () => {
        renderPagesMock.mockResolvedValue([renderedPage(1), renderedPage(2), renderedPage(3)]);
        createBatchesMock.mockResolvedValue({
            successes: [
                { pageNumber: 1, batch: batch("b1") },
                { pageNumber: 3, batch: batch("b3") },
            ],
            failures: [{ pageNumber: 2, error: Object.assign(new Error("quota"), { status: 429 }) }],
        });
        await render("nb-1");
        await pickPdfFile();
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("转为图片并识别导入"),
        ) as HTMLButtonElement;
        await act(async () => confirmButton.click());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("第 2 页"));
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("额度不足"));
        expect(pushMock).toHaveBeenCalledWith("/import-tasks");
    });
});

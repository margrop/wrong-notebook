import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileImportPanel } from "@/components/file-import/file-import-panel";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";

vi.mock("@/lib/feedback", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// 避免测试真正请求 API 或跳转
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: pushMock }),
}));

const createStructuredImportBatchesMock = vi.hoisted(() =>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.fn(async (_items: unknown[], _options: unknown) => ({
        batches: [{ id: "b1" }, { id: "b2" }],
        clientRequestIdPrefix: "sb-test",
        failures: [],
    })),
);
vi.mock("@/lib/import/structured-batches", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/import/structured-batches")>();
    return {
        ...actual,
        MAX_STRUCTURED_ITEMS_TOTAL: actual.MAX_STRUCTURED_ITEMS_TOTAL,
        createStructuredImportBatches: createStructuredImportBatchesMock,
    };
});

// NotebookSelector 内部请求 /api/notebooks，这里 mock 为简单下拉
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
});

const render = (defaultNotebookId?: string) => act(async () => root.render(
    <LanguageProvider><FileImportPanel defaultNotebookId={defaultNotebookId} /></LanguageProvider>
));

function pickFile(file: File) {
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}

describe("FileImportPanel", () => {
    it("初始渲染选择文件入口与模板下载链接", async () => {
        await render();
        expect(container.querySelector('input[type=file]')).not.toBeNull();
        expect(container.textContent).toContain("导入题库文件");
        expect(container.textContent).toContain("下载 Excel 模板");
        expect(container.textContent).toContain("下载 CSV 模板");
    });

    it("选择 JSON 文件后展示摘要（题数、警告、未导入字段）", async () => {
        await render();
        const data = {
            format: "wrong-notebook-questions",
            version: 1,
            questions: [
                { text: "题 1", answer: "A", subject: "数学" },
                { text: "题 2" },
            ],
        };
        const file = new File([JSON.stringify(data)], "bank.json", { type: "application/json" });
        await act(async () => pickFile(file));
        // 解析为微任务，等待摘要出现
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(container.textContent).toContain("共解析出 2 道题");
        expect(container.textContent).toContain("以下字段暂未导入");
        expect(container.textContent).toContain("学科");
        // 摘要视图中出现目标错题本选择
        expect(container.querySelector('[data-testid="notebook-selector"]')).not.toBeNull();
    });

    it("未选择错题本时确认按钮禁用", async () => {
        await render();
        const data = { questions: [{ text: "题 1" }] };
        const file = new File([JSON.stringify(data)], "bank.json", { type: "application/json" });
        await act(async () => pickFile(file));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("导入 1 道题"),
        ) as HTMLButtonElement;
        expect(confirmButton.disabled).toBe(true);
    });

    it("语法错误的 JSON 提示错误并停留选择页", async () => {
        await render();
        const file = new File(["{ bad json"], "bad.json", { type: "application/json" });
        await act(async () => pickFile(file));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(toast.error).toHaveBeenCalled();
        expect(container.textContent).toContain("导入题库文件");
        expect(container.textContent).not.toContain("共解析出");
    });

    it("确认后创建多个批次时跳转到导入中心列表", async () => {
        createStructuredImportBatchesMock.mockResolvedValueOnce({
            batches: [{ id: "b1" }, { id: "b2" }],
            clientRequestIdPrefix: "sb-test",
            failures: [],
        });
        await render("nb-1");
        const data = { questions: [{ text: "题 1" }, { text: "题 2" }] };
        const file = new File([JSON.stringify(data)], "bank.json", { type: "application/json" });
        await act(async () => pickFile(file));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("导入 2 道题"),
        ) as HTMLButtonElement;
        await act(async () => confirmButton.click());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(createStructuredImportBatchesMock).toHaveBeenCalled();
        expect(pushMock).toHaveBeenCalledWith("/import-tasks");
    });

    it("确认后只创建 1 个批次时直达批次详情页", async () => {
        createStructuredImportBatchesMock.mockResolvedValueOnce({
            batches: [{ id: "b-only" }],
            clientRequestIdPrefix: "sb-test",
            failures: [],
        });
        await render("nb-1");
        const data = { questions: [{ text: "题 1" }] };
        const file = new File([JSON.stringify(data)], "bank.json", { type: "application/json" });
        await act(async () => pickFile(file));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        const confirmButton = Array.from(container.querySelectorAll("button")).find((btn) =>
            btn.textContent?.includes("导入 1 道题"),
        ) as HTMLButtonElement;
        await act(async () => confirmButton.click());
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(pushMock).toHaveBeenCalledWith("/import-batches/b-only");
    });
});

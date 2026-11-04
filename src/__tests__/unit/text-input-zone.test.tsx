import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextInputZone } from "@/components/text-input-zone";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { confirmDialog, toast } from "@/lib/feedback";

vi.mock("@/lib/feedback", () => ({
    toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
    confirmDialog: vi.fn(async () => true),
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

const render = (props: Partial<Parameters<typeof TextInputZone>[0]> = {}) => act(async () => root.render(
    <LanguageProvider>
        <TextInputZone onSubmit={vi.fn()} isAnalyzing={false} {...props} />
    </LanguageProvider>
));

function pickFile(file: File) {
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
}

describe("TextInputZone 从文件导入", () => {
    it("选择 TXT 文件时填入文字框", async () => {
        await render();
        const file = new File(["第一题"], "note.txt", { type: "text/plain" });
        await act(async () => pickFile(file));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
        expect(textarea.value).toContain("第一题");
    });

    it("选择题库文件（docx）时不填入文字框，提示切换到导入题库文件", async () => {
        const onSwitchToFileImport = vi.fn();
        await render({ onSwitchToFileImport });
        const file = new File(["x"], "bank.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        await act(async () => pickFile(file));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        // confirmDialog 返回 true，应触发切换
        expect(confirmDialog).toHaveBeenCalled();
        expect(onSwitchToFileImport).toHaveBeenCalled();
        // 文字框未被写入 docx 乱码
        const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
        expect(textarea.value).toBe("");
    });

    it("选择题库文件（json）且用户取消时停留在文字录入", async () => {
        vi.mocked(confirmDialog).mockResolvedValueOnce(false);
        const onSwitchToFileImport = vi.fn();
        await render({ onSwitchToFileImport });
        const file = new File(["{}"], "bank.json", { type: "application/json" });
        await act(async () => pickFile(file));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(onSwitchToFileImport).not.toHaveBeenCalled();
        const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
        expect(textarea.value).toBe("");
    });

    it("未提供 onSwitchToFileImport 时选择题库文件提示 info", async () => {
        await render();
        const file = new File(["x"], "bank.xlsx", {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        await act(async () => pickFile(file));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(toast.info).toHaveBeenCalled();
        const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
        expect(textarea.value).toBe("");
    });
});

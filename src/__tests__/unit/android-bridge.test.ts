/**
 * 安卓 App 的 bridge.js：导出文件分块交给原生写入临时文件，并等待原生保存结果，
 * 避免整份文件转成 data URL 一次性跨 JS 桥造成内存峰值或 App 被系统回收。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Mock } from "vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const BRIDGE_SCRIPT = readFileSync(
    join(process.cwd(), "packaging/android/app/src/main/assets/bridge.js"),
    "utf8",
);

interface BridgeMethods {
    beginSaveFile: Mock;
    appendSaveFileChunk: Mock;
    endSaveFile: Mock;
    abortSaveFile: Mock;
    print: Mock;
    changeServer: Mock;
}

let bridge: BridgeMethods;

type WindowWithBridge = Window & {
    WrongNotebookAndroid?: BridgeMethods;
    __wrongNotebookSaveAndWait?: (blob: Blob, name: string) => Promise<{ saved: boolean; canceled?: boolean; message?: string }>;
    __wrongNotebookOnSaveResult?: (saved: boolean, canceled: boolean, message: string) => void;
    __wrongNotebookSave?: (href: string, name: string) => Promise<unknown>;
};

function bridgeWindow(): WindowWithBridge {
    return window as WindowWithBridge;
}

beforeAll(() => {
    // jsdom 未实现 blob URL 生命周期接口；bridge.js 在安卓 WebView 中会直接接管
    Object.defineProperty(window.URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    bridge = {
        beginSaveFile: vi.fn(),
        appendSaveFileChunk: vi.fn(),
        endSaveFile: vi.fn(),
        abortSaveFile: vi.fn(),
        print: vi.fn(),
        changeServer: vi.fn(),
    };
    bridgeWindow().WrongNotebookAndroid = bridge;
    new Function(BRIDGE_SCRIPT)();
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe("安卓导出文件桥", () => {
    it("分块传输完整内容，原生保存成功后才返回 saved", async () => {
        const payload = new Uint8Array(300 * 1024);
        for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
        const blob = new Blob([payload], { type: "application/json;charset=utf-8" });

        const promise = bridgeWindow().__wrongNotebookSaveAndWait!(blob, "wrong-notebook-export.json");
        await vi.waitFor(() => expect(bridge.endSaveFile).toHaveBeenCalled(), { timeout: 3000 });

        expect(bridge.beginSaveFile).toHaveBeenCalledWith("wrong-notebook-export.json", "application/json;charset=utf-8");
        const chunks = bridge.appendSaveFileChunk.mock.calls.map(([chunk]) => String(chunk));
        expect(chunks.length).toBeGreaterThan(1);
        const decoded = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64")));
        expect(decoded.equals(Buffer.from(payload))).toBe(true);

        bridgeWindow().__wrongNotebookOnSaveResult!(true, false, "wrong-notebook-export.json");
        await expect(promise).resolves.toEqual({
            saved: true,
            canceled: false,
            message: "wrong-notebook-export.json",
        });
    });

    it("用户取消保存时返回 canceled，不误报成功", async () => {
        const blob = new Blob(["{}"], { type: "application/json" });
        const promise = bridgeWindow().__wrongNotebookSaveAndWait!(blob, "backup.json");
        await vi.waitFor(() => expect(bridge.endSaveFile).toHaveBeenCalled());

        bridgeWindow().__wrongNotebookOnSaveResult!(false, true, "已取消保存");
        await expect(promise).resolves.toEqual({
            saved: false,
            canceled: true,
            message: "已取消保存",
        });
    });

    it("脚本创建的 blob 下载链接仍被拦截并走分块保存", async () => {
        const blob = new Blob(["backup"], { type: "application/json" });
        vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => blob })));

        const anchor = document.createElement("a");
        anchor.href = "blob:http://127.0.0.1/export";
        anchor.setAttribute("download", "wrong-notebook-export.json");
        anchor.click();
        await vi.waitFor(() => expect(bridge.endSaveFile).toHaveBeenCalled());
        expect(bridge.beginSaveFile).toHaveBeenCalledWith("wrong-notebook-export.json", "application/json");

        bridgeWindow().__wrongNotebookOnSaveResult!(true, false, "wrong-notebook-export.json");
    });
});

/**
 * 文件下载：安卓 App 走原生保存并等待结果，普通浏览器走 anchor 下载；
 * 返回 false 表示用户在安卓「另存为」中取消，调用方不应提示成功。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlobFile, downloadFile } from "@/lib/download-file";

interface AndroidSaveResult {
    saved: boolean;
    canceled?: boolean;
    message?: string;
}

type WindowWithAndroidSave = Window & {
    __wrongNotebookSaveAndWait?: (blob: Blob, name: string) => Promise<AndroidSaveResult>;
};

function androidSaveWindow(): WindowWithAndroidSave {
    return window as WindowWithAndroidSave;
}

beforeEach(() => {
    delete androidSaveWindow().__wrongNotebookSaveAndWait;
    Object.defineProperty(window.URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(window.URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("downloadBlobFile", () => {
    it("安卓 App 等待原生保存结果，写入成功后返回 true", async () => {
        const blob = new Blob(["{}"], { type: "application/json" });
        const save = vi.fn(async () => ({ saved: true, canceled: false, message: "backup.json" }));
        androidSaveWindow().__wrongNotebookSaveAndWait = save;

        await expect(downloadBlobFile(blob, "backup.json")).resolves.toBe(true);
        expect(save).toHaveBeenCalledWith(blob, "backup.json");
    });

    it("安卓 App 用户取消保存时返回 false，不当作失败", async () => {
        const save = vi.fn(async () => ({ saved: false, canceled: true, message: "已取消保存" }));
        androidSaveWindow().__wrongNotebookSaveAndWait = save;

        await expect(downloadBlobFile(new Blob(["{}"]), "backup.json")).resolves.toBe(false);
    });

    it("安卓 App 保存失败时抛出原生错误信息", async () => {
        androidSaveWindow().__wrongNotebookSaveAndWait = vi.fn(async () => ({ saved: false, message: "保存文件失败" }));

        await expect(downloadBlobFile(new Blob(["{}"]), "backup.json")).rejects.toThrow("保存文件失败");
    });

    it("普通浏览器创建 blob 链接并以文件名下载", async () => {
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
        const blob = new Blob(["{}"], { type: "application/json" });

        await expect(downloadBlobFile(blob, "backup.json")).resolves.toBe(true);
        const clicked = clickSpy.mock.instances[0] as HTMLAnchorElement | undefined;
        expect(clicked?.download).toBe("backup.json");
        expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    });
});

describe("downloadFile", () => {
    it("优先使用响应头的文件名，并把 Blob 交给安卓原生保存", async () => {
        const blob = new Blob(["{}"], { type: "application/json" });
        const save = vi.fn(async () => ({ saved: true }));
        androidSaveWindow().__wrongNotebookSaveAndWait = save;
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            headers: { get: (name: string) => name === "Content-Disposition" ? `attachment; filename="wrong-notebook-export-2026-11-09.json"` : null },
            blob: async () => blob,
            json: async () => ({}),
        })));

        await expect(downloadFile("/api/export", "fallback.json")).resolves.toBe(true);
        expect(save).toHaveBeenCalledWith(blob, "wrong-notebook-export-2026-11-09.json");
    });

    it("接口失败时抛出服务端错误信息", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: false,
            headers: { get: () => null },
            blob: async () => new Blob(["{}"]),
            json: async () => ({ message: "Forbidden" }),
        })));

        await expect(downloadFile("/api/export", "fallback.json")).rejects.toThrow("Forbidden");
    });
});

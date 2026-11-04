import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    clipboardImageToFile,
    extractImageFromPasteEvent,
    isClipboardReadSupported,
    isScreenshotSupported,
} from "@/lib/hooks/use-upload-files";

describe("use-upload-files 纯函数", () => {
    describe("clipboardImageToFile", () => {
        it("无名字的 Blob 按类型生成文件名", () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date("2026-11-04T12:00:00Z"));
            const blob = new Blob(["x"], { type: "image/png" });
            const file = clipboardImageToFile(blob);
            expect(file).toBeInstanceOf(File);
            expect(file.name).toMatch(/^clipboard-\d+\.png$/);
            expect(file.type).toBe("image/png");
            vi.useRealTimers();
        });

        it("Blob 缺少 type 时回退为 image/png", () => {
            const blob = new Blob(["x"]);
            const file = clipboardImageToFile(blob);
            expect(file.type).toBe("image/png");
            expect(file.name).toMatch(/\.png$/);
        });

        it("带名字的 File 原样返回", () => {
            const original = new File(["x"], "pasted.png", { type: "image/png" });
            expect(clipboardImageToFile(original)).toBe(original);
        });

        it("File 名字为空字符串时生成新名字", () => {
            const emptyName = new File(["x"], "", { type: "image/jpeg" });
            const file = clipboardImageToFile(emptyName);
            expect(file.name).toMatch(/^clipboard-\d+\.jpeg$/);
        });
    });

    describe("extractImageFromPasteEvent", () => {
        const makeEvent = (items: Partial<DataTransferItem>[], target: EventTarget | null = null): ClipboardEvent =>
            ({ clipboardData: { items }, target }) as unknown as ClipboardEvent;

        it("提取第一个图片 item", () => {
            const png = new File(["x"], "a.png", { type: "image/png" });
            const event = makeEvent([
                { kind: "string", type: "text/plain" },
                { kind: "file", type: "image/png", getAsFile: () => png },
            ]);
            expect(extractImageFromPasteEvent(event)).toBe(png);
        });

        it("没有图片时返回 null", () => {
            const event = makeEvent([{ kind: "string", type: "text/plain" }]);
            expect(extractImageFromPasteEvent(event)).toBeNull();
        });

        it("clipboardData 缺失时返回 null", () => {
            const event = { clipboardData: null } as unknown as ClipboardEvent;
            expect(extractImageFromPasteEvent(event)).toBeNull();
        });

        it("目标是 INPUT 时不拦截（返回 null）", () => {
            const png = new File(["x"], "a.png", { type: "image/png" });
            const target = document.createElement("input");
            const event = makeEvent(
                [{ kind: "file", type: "image/png", getAsFile: () => png }],
                target,
            );
            expect(extractImageFromPasteEvent(event)).toBeNull();
        });

        it("目标是 contentEditable 元素时不拦截（返回 null）", () => {
            const png = new File(["x"], "a.png", { type: "image/png" });
            const target = document.createElement("div");
            Object.defineProperty(target, "isContentEditable", { value: true });
            const event = makeEvent(
                [{ kind: "file", type: "image/png", getAsFile: () => png }],
                target,
            );
            expect(extractImageFromPasteEvent(event)).toBeNull();
        });
    });

    describe("isClipboardReadSupported", () => {
        const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

        beforeEach(() => {
            Object.defineProperty(navigator, "clipboard", {
                value: { read: vi.fn() },
                configurable: true,
            });
        });

        afterEach(() => {
            if (originalClipboard) {
                Object.defineProperty(navigator, "clipboard", originalClipboard);
            } else {
                // @ts-expect-error 恢复为未定义
                delete navigator.clipboard;
            }
        });

        it("客户端且支持 clipboard.read 时返回 true", () => {
            expect(isClipboardReadSupported(true)).toBe(true);
        });

        it("非客户端（SSR）时返回 false", () => {
            expect(isClipboardReadSupported(false)).toBe(false);
        });

        it("缺少 clipboard API 时返回 false", () => {
            // @ts-expect-error 模拟不支持的环境
            delete navigator.clipboard;
            expect(isClipboardReadSupported(true)).toBe(false);
        });

        it("clipboard.read 不是函数时返回 false", () => {
            Object.defineProperty(navigator, "clipboard", { value: {}, configurable: true });
            expect(isClipboardReadSupported(true)).toBe(false);
        });
    });

    describe("isScreenshotSupported", () => {
        it("非客户端（SSR）时返回 false", () => {
            expect(isScreenshotSupported(false)).toBe(false);
        });

        it("客户端但缺少 getDisplayMedia 时返回 false", () => {
            const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
            Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true });
            expect(isScreenshotSupported(true)).toBe(false);
            if (originalMediaDevices) {
                Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
            } else {
                // @ts-expect-error 恢复为未定义
                delete navigator.mediaDevices;
            }
        });
    });
});

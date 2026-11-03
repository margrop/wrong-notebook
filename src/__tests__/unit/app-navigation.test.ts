import { describe, expect, it } from "vitest";
import { APP_BRAND, BARE_PATHS, NAV_ITEMS, findActiveNavKey, isBarePath } from "@/lib/app-navigation";
import { translations } from "@/lib/translations";

describe("app-navigation", () => {
    it("BARE_PATHS 匹配无导航路径", () => {
        expect(isBarePath("/login")).toBe(true);
        expect(isBarePath("/login?callbackUrl=%2F")).toBe(true);
        expect(isBarePath("/register")).toBe(true);
        expect(isBarePath("/setup")).toBe(true);
        expect(isBarePath("/setup/abc")).toBe(true);
        expect(isBarePath("/print-preview")).toBe(true);
        expect(isBarePath("/exams/abc/print")).toBe(true);
        expect(isBarePath("/exams/123/print")).toBe(true);
    });

    it("BARE_PATHS 不匹配正常页面", () => {
        expect(isBarePath("/")).toBe(false);
        expect(isBarePath("/notebooks")).toBe(false);
        expect(isBarePath("/exams")).toBe(false);
        expect(isBarePath("/exams/abc")).toBe(false);
        expect(isBarePath("/stats")).toBe(false);
    });

    it("BARE_PATHS 前缀匹配，未锚定结尾（保持原行为）", () => {
        expect(isBarePath("/exams/abc/print-other")).toBe(true);
        expect(isBarePath("/print-preview-other")).toBe(true);
    });

    it("findActiveNavKey 高亮规则", () => {
        expect(findActiveNavKey("/")).toBe("home");
        expect(findActiveNavKey("/notebooks")).toBe("notebooks");
        expect(findActiveNavKey("/notebooks/abc")).toBe("notebooks");
        expect(findActiveNavKey("/error-items/x")).toBe("notebooks");
        expect(findActiveNavKey("/practice/y")).toBe("notebooks");
        expect(findActiveNavKey("/review")).toBe("review");
        expect(findActiveNavKey("/review/today")).toBe("review");
        expect(findActiveNavKey("/stats")).toBe("stats");
        expect(findActiveNavKey("/tags")).toBe("stats");
        expect(findActiveNavKey("/exams")).toBe("exams");
        expect(findActiveNavKey("/exams/1")).toBe("exams");
        expect(findActiveNavKey("/unknown")).toBeNull();
    });

    it("每个导航项 key 都存在于中英 translations 的 nav 中", () => {
        const enNav = translations.en.nav;
        const zhNav = translations.zh.nav;
        for (const item of NAV_ITEMS) {
            expect(enNav[item.key]).toBeDefined();
            expect(zhNav[item.key]).toBeDefined();
        }
    });

    it("导航项 icon 与 href 均存在", () => {
        for (const item of NAV_ITEMS) {
            expect(item.href).toBeTruthy();
            expect(item.icon).toBeTruthy();
        }
    });

    it("APP_BRAND 默认图标路径", () => {
        expect(APP_BRAND.iconSrc).toBe("/icons/icon.png");
    });

    it("BARE_PATHS 与 isBarePath 行为一致", () => {
        const paths = ["/", "/login", "/print-preview", "/exams/1/print", "/notebooks", "/stats", "/unknown"];
        for (const p of paths) {
            expect(isBarePath(p)).toBe(BARE_PATHS.some((r) => r.test(p)));
        }
    });
});

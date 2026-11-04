/**
 * scripts/copy-pdfjs-assets.mjs 的单元测试：
 * 验证脚本能从 pdfjs-dist 复制 cmaps/ 与 standard_fonts/ 到 public/pdfjs/，
 * 并包含预期文件（.bcmap 与 .pfb）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const SCRIPT = join(ROOT, "scripts", "copy-pdfjs-assets.mjs");
const OUT_DIR = join(ROOT, "public", "pdfjs");

describe("copy-pdfjs-assets.mjs", () => {
    beforeEach(() => {
        rmSync(OUT_DIR, { recursive: true, force: true });
    });

    afterEach(() => {
        rmSync(OUT_DIR, { recursive: true, force: true });
    });

    it("从 pdfjs-dist 复制 cmaps 与 standard_fonts 到 public/pdfjs/", () => {
        execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, stdio: "pipe" });
        expect(existsSync(join(OUT_DIR, "cmaps"))).toBe(true);
        expect(existsSync(join(OUT_DIR, "standard_fonts"))).toBe(true);
        // cmaps 目录应包含 .bcmap 文件
        const cmaps = readdirSync(join(OUT_DIR, "cmaps"));
        expect(cmaps.some((f) => f.endsWith(".bcmap"))).toBe(true);
        // standard_fonts 目录应包含 .pfb 文件
        const fonts = readdirSync(join(OUT_DIR, "standard_fonts"));
        expect(fonts.some((f) => f.endsWith(".pfb"))).toBe(true);
    });

    it("重复运行时先清理再复制（幂等）", () => {
        execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, stdio: "pipe" });
        execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, stdio: "pipe" });
        expect(existsSync(join(OUT_DIR, "cmaps"))).toBe(true);
        expect(existsSync(join(OUT_DIR, "standard_fonts"))).toBe(true);
    });
});

#!/usr/bin/env node
/**
 * 构建前把 pdfjs-dist 的 cmaps/ 与 standard_fonts/ 复制到 public/pdfjs/，
 * 供浏览器端 getDocument 通过同源静态路径加载（见 src/lib/import/file-parsers/pdf/load-pdfjs.ts）。
 *
 * 由 npm 的 predev / prebuild 自动执行，安装包构建（scripts/package/build.mjs）与 E2E（scripts/run-e2e.mjs）
 * 直接调用 next build 前也会执行；也可手动运行：node scripts/copy-pdfjs-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PDFJS_DIST = path.join(ROOT, "node_modules", "pdfjs-dist");
const OUT_DIR = path.join(ROOT, "public", "pdfjs");

const ASSETS = ["cmaps", "standard_fonts"];

function copyAsset(name) {
    const src = path.join(PDFJS_DIST, name);
    const dest = path.join(OUT_DIR, name);
    if (!fs.existsSync(src)) {
        throw new Error(`未找到 pdfjs-dist 目录：${src}（请先 npm ci）`);
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    const count = fs.readdirSync(dest).length;
    console.log(`[copy-pdfjs-assets] ${name} → public/pdfjs/${name}（${count} 个文件）`);
}

for (const name of ASSETS) {
    copyAsset(name);
}
console.log("[copy-pdfjs-assets] 完成");

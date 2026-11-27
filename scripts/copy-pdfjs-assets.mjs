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

/** 递归删除：只用 readdir/unlink/rmdir，不使用 rmSync */
function removeTree(target) {
    if (!fs.existsSync(target)) return;
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const full = path.join(target, entry.name);
        if (entry.isDirectory()) removeTree(full);
        else fs.unlinkSync(full);
    }
    fs.rmdirSync(target);
}

/**
 * 逐文件把 src 同步到 dest，并删除 dest 中多余的条目。
 *
 * 不使用 fs.cpSync / fs.rmSync：在 Windows 上，当仓库路径含非 ASCII 字符
 * （例如 D:\高中学习\...）且机器装有文件监控类安全软件时，这两个 API 会抛
 * EPERM/EIO（`fs.rmSync` 连空目录都删不掉，`fs.cpSync` 报 Access is denied），
 * 而 copyFileSync / unlinkSync 工作正常。
 */
function syncTree(src, dest) {
    fs.mkdirSync(dest, { recursive: true });

    const sourceEntries = new Map(
        fs.readdirSync(src, { withFileTypes: true }).map((entry) => [entry.name, entry]),
    );

    for (const [name, entry] of sourceEntries) {
        const from = path.join(src, name);
        const to = path.join(dest, name);
        if (entry.isDirectory()) syncTree(from, to);
        else fs.copyFileSync(from, to);
    }

    for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
        if (sourceEntries.has(entry.name)) continue;
        const full = path.join(dest, entry.name);
        if (entry.isDirectory()) removeTree(full);
        else fs.unlinkSync(full);
    }
}

function copyAsset(name) {
    const src = path.join(PDFJS_DIST, name);
    const dest = path.join(OUT_DIR, name);
    if (!fs.existsSync(src)) {
        throw new Error(`未找到 pdfjs-dist 目录：${src}（请先 npm ci）`);
    }
    syncTree(src, dest);
    const count = fs.readdirSync(dest).length;
    console.log(`[copy-pdfjs-assets] ${name} → public/pdfjs/${name}（${count} 个文件）`);
}

for (const name of ASSETS) {
    copyAsset(name);
}
console.log("[copy-pdfjs-assets] 完成");

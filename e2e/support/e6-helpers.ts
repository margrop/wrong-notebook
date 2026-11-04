/**
 * E6 任务专用辅助：构造最小 PNG data URL、读取 .xlsx、解压 .docx。
 * 仅服务于 e2e/question-export.spec.ts。
 */
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import type { Page } from './fixtures';

/** 最小 1x1 红色 PNG（67 字节），作为「含原图」错题的 originalImageUrl */
const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

/** 解压 .docx（zip），返回路径 → 内容映射；XML 条目为 UTF-8 文本，二进制条目为字节数（String(length)） */
export function unzipDocx(buffer: Buffer): Record<string, string> {
    const entries = unzipSync(new Uint8Array(buffer));
    const result: Record<string, string> = {};
    for (const [path, bytes] of Object.entries(entries)) {
        if (path.endsWith('.xml') || path.endsWith('.rels')) {
            result[path] = new TextDecoder('utf-8').decode(bytes);
        } else {
            result[path] = String(bytes.length);
        }
    }
    return result;
}

/** 读取 .xlsx 第一个工作表为二维数组（首行为表头，单元格统一转字符串） */
export async function readXlsxRows(buffer: Buffer): Promise<string[][]> {
    const { default: readExcelFile } = await import('read-excel-file/node');
    const sheets = await readExcelFile(buffer) as Array<{ data: unknown[][] }>;
    const data = sheets[0]?.data ?? [];
    return data.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))));
}

interface DownloadCapture {
    name: string;
    buffer: Buffer;
}

/** 等待浏览器下载事件并读取内容（不依赖 download.path() 的持久化语义） */
export async function captureDownload(page: Page, trigger: () => Promise<void>): Promise<DownloadCapture> {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        trigger(),
    ]);
    const path = await download.path();
    if (!path) throw new Error(`下载失败：${download.suggestedFilename()}`);
    return { name: download.suggestedFilename(), buffer: readFileSync(path) };
}

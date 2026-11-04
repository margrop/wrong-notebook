/**
 * E4 任务专用辅助：手写最小 PDF 夹具（不依赖外部 PDF 生成库）。
 * - makeTextPdf：Type1 Helvetica（WinAnsi），输出英文/数字题目文字。
 * - makeTextPdfWithRects：文字 + 矩形矢量图形（供题目原图截图测试）。
 * - makeScannedPdf：只绘制矩形的空白内容流（无文字层），模拟扫描版 PDF。
 * - makeCorruptPdf：有 %PDF 文件头但内容无效。
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

function escapePdfText(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function isWinAnsi(text: string): boolean {
    return !/[^\x20-\x7e]/.test(text);
}

export interface PdfLine {
    text: string;
    x?: number;
    y: number;
    size?: number;
}

/** 矩形绘制（y 为自上而下位置，pt） */
export interface PdfRect {
    x: number;
    y: number;
    width: number;
    height: number;
    /** 描边灰度 0-1，默认 0（黑） */
    strokeGray?: number;
    /** 填充灰度 0-1；设置后填充 */
    fillGray?: number;
}

/** 生成一页的文字内容流：每行一个 Tj 调用（y 自上而下，PDF 原点在左下需翻转） */
function textPageContent(lines: PdfLine[]): string {
    const parts: string[] = [];
    for (const line of lines) {
        const size = line.size ?? 12;
        const pdfY = PAGE_HEIGHT - line.y;
        const x = line.x ?? 72;
        if (!isWinAnsi(line.text)) {
            throw new Error(`e4-helpers 仅支持 WinAnsi 字符：${line.text}`);
        }
        parts.push(`BT /F1 ${size} Tf ${x} ${pdfY} Td (${escapePdfText(line.text)}) Tj ET`);
    }
    return parts.join("\n");
}

/** 矩形绘制内容流（re 操作符） */
function rectPageContent(rects: PdfRect[]): string {
    const parts: string[] = [];
    for (const rect of rects) {
        const pdfY = PAGE_HEIGHT - rect.y - rect.height;
        const strokeGray = rect.strokeGray ?? 0;
        const fillGray = rect.fillGray ?? null;
        if (fillGray !== null) {
            parts.push(`q ${fillGray} g ${strokeGray} G ${rect.x} ${pdfY} ${rect.width} ${rect.height} re B Q`);
        } else {
            parts.push(`q ${strokeGray} G ${rect.x} ${pdfY} ${rect.width} ${rect.height} re S Q`);
        }
    }
    return parts.join("\n");
}

/** 空白内容流：只画几个矩形，没有文字操作符 */
function scannedPageContent(): string {
    return "0.9 g\n100 650 412 92 re f\n100 500 412 92 re f\n100 350 412 92 re f\n0 g";
}

/** 手写最小 PDF（多页），每页内容流由 contentFor(index) 给出 */
function makePdfBuffer(pageCount: number, contentFor: (index: number) => string): ArrayBuffer {
    const objects: string[] = [];
    const firstPageObj = 4;
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    const kids = Array.from({ length: pageCount }, (_, index) => `${firstPageObj + index * 2} 0 R`).join(" ");
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    for (let index = 0; index < pageCount; index++) {
        const pageObj = firstPageObj + index * 2;
        const contentObj = pageObj + 1;
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`);
        const content = contentFor(index);
        objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    }

    let output = "%PDF-1.4\n";
    const offsets: number[] = [0];
    objects.forEach((object, index) => {
        offsets[index + 1] = Buffer.byteLength(output);
        output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefStart = Buffer.byteLength(output);
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= objects.length; index++) {
        output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    const bytes = Buffer.from(output, "latin1");
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** 文字版 PDF：pages[i] 为该页的文字行 */
export function makeTextPdf(pages: PdfLine[][]): ArrayBuffer {
    return makePdfBuffer(pages.length, (index) => textPageContent(pages[index]));
}

/** 文字版 PDF（含矩形图形）：pages[i] 为该页的文字行与矩形 */
export function makeTextPdfWithRects(pages: Array<{ lines: PdfLine[]; rects: PdfRect[] }>): ArrayBuffer {
    return makePdfBuffer(pages.length, (index) => {
        const text = textPageContent(pages[index].lines);
        const rects = rectPageContent(pages[index].rects);
        return [text, rects].filter(Boolean).join("\n");
    });
}

/** 扫描版 PDF：N 页、只画矩形没有文字 */
export function makeScannedPdf(pageCount: number): ArrayBuffer {
    return makePdfBuffer(pageCount, () => scannedPageContent());
}

/** 损坏的 PDF（有文件头但内容无效） */
export function makeCorruptPdf(): ArrayBuffer {
    const bytes = Buffer.from("%PDF-1.4\nthis is not a real pdf body\n%%EOF", "latin1");
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

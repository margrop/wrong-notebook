/**
 * 手写最小 PDF 的测试夹具：Type1 标准字体 Helvetica（WinAnsi 编码），
 * 输出英文与数字题目文字；xref 偏移按字节正确计算，可被 pdfjs-dist 解析。
 * 不依赖外部 PDF 生成库。
 * 注：中文场景由 layout.ts 纯函数测试用构造数据覆盖（见 pdf-layout.test.ts）。
 */

/** 单页的文字行（y 为自上而下位置，pt；x 默认 72） */
export interface PdfFixtureLine {
    text: string;
    x?: number;
    y: number;
    size?: number;
}

export interface PdfFixturePage {
    lines: PdfFixtureLine[];
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

/** PDF 转义（字符串字面量内） */
function escapePdfText(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** 是否可用 WinAnsi 编码表示（本夹具只支持英文与数字） */
function isWinAnsi(text: string): boolean {
    return !/[^\x20-\x7e]/.test(text);
}

/** 生成一页的内容流：每行一个 Tj 调用，y 自上而下（PDF 原点在左下，需翻转） */
function pageContent(page: PdfFixturePage): string {
    const parts: string[] = [];
    for (const line of page.lines) {
        const size = line.size ?? 12;
        const pdfY = PAGE_HEIGHT - line.y;
        const x = line.x ?? 72;
        if (!isWinAnsi(line.text)) {
            throw new Error(`pdf-fixture 仅支持 WinAnsi 字符：${line.text}`);
        }
        parts.push(`BT /F1 ${size} Tf ${x} ${pdfY} Td (${escapePdfText(line.text)}) Tj ET`);
    }
    return parts.join("\n");
}

/** 手写最小 PDF（多页），返回 ArrayBuffer */
export function makePdfBuffer(pages: PdfFixturePage[]): ArrayBuffer {
    const objects: string[] = [];
    // 1: Catalog, 2: Pages, 3: Font Helvetica, 之后每页两个对象（page + content）
    const firstPageObj = 4;
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    const kids = pages.map((_, index) => `${firstPageObj + index * 2} 0 R`).join(" ");
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    pages.forEach((page, index) => {
        const pageObj = firstPageObj + index * 2;
        const contentObj = pageObj + 1;
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`);
        const content = pageContent(page);
        objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    });

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

/** 损坏的 PDF（有文件头但内容无效） */
export function makeCorruptPdfBuffer(): ArrayBuffer {
    const bytes = Buffer.from("%PDF-1.4\nthis is not a real pdf body\n%%EOF", "latin1");
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

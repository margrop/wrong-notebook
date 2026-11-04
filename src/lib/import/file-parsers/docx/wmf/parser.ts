/**
 * 轻量 WMF（Windows Metafile）解析器，用于 Word（.docx）中 MathType /
 * 公式编辑器 OLE 公式对象的 WMF 预览图。
 *
 * 背景：rtf.js 的 WMFJS 不支持 SetTextAlign 的 TA_UPDATECP 定位方式，
 * MathType 生成的 WMF 依赖该方式放置文字，导致渲染结果只有分数线、文字全部堆在 (0,0)。
 * 本模块只实现 MathType/公式编辑器常用记录，无第三方依赖。
 *
 * 支持的记录：
 * - 坐标：META_SETWINDOWORG/EXT、META_SETVIEWPORTORG/EXT、META_SETMAPMODE、META_MOVETO；
 * - 对象：CREATEFONTINDIRECT/CREATEPENINDIRECT/CREATEBRUSHINDIRECT、SELECTOBJECT、DELETEOBJECT
 *   （按 WMF 对象表槽位规则管理，槽位可复用）；
 * - 状态：SETTEXTALIGN（含 TA_UPDATECP）、SETTEXTCOLOR、SETBKMODE、SAVEDC/RESTOREDC；
 * - 绘制：LINETO、POLYLINE、POLYGON、RECTANGLE、TEXTOUT、EXTTEXTOUT（含 dx 数组逐字定位）；
 * - 其余记录（如 META_ESCAPE）忽略。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */

/** 字体对象：META_CREATEFONTINDIRECT 解析结果 */
export interface WmfFont {
    kind: "font";
    /** lfHeight：字号高度（逻辑单位，可为负表示字符高度） */
    height: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikeOut: boolean;
    /** lfCharSet（0=ANSI，134=GB2312，2=Symbol 等） */
    charSet: number;
    /** lfFaceName，去掉结尾 NUL 后的原始名 */
    faceName: string;
}

/** 画笔对象：META_CREATEPENINDIRECT 解析结果 */
export interface WmfPen {
    kind: "pen";
    style: number;
    width: number;
    color: number;
}

/** 画刷对象：META_CREATEBRUSHINDIRECT 解析结果 */
export interface WmfBrush {
    kind: "brush";
    style: number;
    color: number;
}

export type WmfObject = WmfFont | WmfPen | WmfBrush;

/** 文本对齐标志（META_SETTEXTALIGN） */
export const TA_UPDATECP = 0x0001;
export const TA_RIGHT = 0x0002;
export const TA_CENTER = 0x0006;
export const TA_BOTTOM = 0x0008;
export const TA_BASELINE = 0x0018;
export const TA_MASK_H = 0x0006;
export const TA_MASK_V = 0x0018;

/** 背景模式（META_SETBKMODE） */
export const BKMODE_TRANSPARENT = 1;
export const BKMODE_OPAQUE = 2;

/** META_ESCAPE(0x0626) 等无关记录直接忽略 */

/** 一次文字绘制操作（EXTTEXTOUT/TEXTOUT 展开后的单条指令，可能有逐字拆分） */
export interface WmfTextOp {
    x: number;
    y: number;
    text: string;
    font: WmfFont | null;
    color: number;
    align: number;
    bkMode: number;
}

/** 一段折线（POLYLINE / 连续 LINETO 合并） */
export interface WmfPolylineOp {
    points: Array<{ x: number; y: number }>;
    color: number;
}

/** 一个多边形（POLYGON / RECTANGLE） */
export interface WmfPolygonOp {
    points: Array<{ x: number; y: number }>;
    color: number;
}

/** 解析结果：按出现顺序的绘制指令与 viewBox 信息 */
export interface WmfParseResult {
    viewBox: { x: number; y: number; width: number; height: number };
    texts: WmfTextOp[];
    polylines: WmfPolylineOp[];
    polygons: WmfPolygonOp[];
    /** 是否使用了 TA_UPDATECP（诊断用） */
    usedUpdateCp: boolean;
}

/** WMF 记录号 */
const META_EOF = 0x0000;
const META_SAVEDC = 0x001e;
const META_RESTOREDC = 0x0127;
const META_SELECTOBJECT = 0x012d;
const META_SETTEXTALIGN = 0x012e;
const META_DELETEOBJECT = 0x01f0;
const META_SETBKMODE = 0x0102;
const META_SETMAPMODE = 0x0103;
const META_SETTEXTCOLOR = 0x0209;
const META_SETWINDOWORG = 0x020b;
const META_SETWINDOWEXT = 0x020c;
const META_SETVIEWPORTORG = 0x020d;
const META_SETVIEWPORTEXT = 0x020e;
const META_MOVETO = 0x0214;
const META_LINETO = 0x0213;
const META_CREATEPENINDIRECT = 0x02fa;
const META_CREATEFONTINDIRECT = 0x02fb;
const META_CREATEBRUSHINDIRECT = 0x02fc;
const META_POLYGON = 0x0324;
const META_POLYLINE = 0x0325;
const META_RECTANGLE = 0x041b;
const META_TEXTOUT = 0x0521;
const META_EXTTEXTOUT = 0x0a32;

/** ETO 标志（META_EXTTEXTOUT） */
const ETO_OPAQUE = 0x0002;
const ETO_CLIPPED = 0x0004;

/** Aldus placeable 头魔数 */
const PLACEABLE_KEY = 0x9ac6cdd7;

/** WMF 对象表槽位数（WMF 3.0 及以上为 10，3.0 以下为 5；用 10 兼容两者） */
const OBJECT_TABLE_SIZE = 10;

/** CREATEFONTINDIRECT 的 LOGFONT 中 lfWeight ≥ 该值视为粗体 */
const FW_BOLD_THRESHOLD = 600;

/** 有符号 16 位读取 */
function i16(view: DataView, offset: number): number {
    return view.getInt16(offset, true);
}

/** 无符号 16 位读取 */
function u16(view: DataView, offset: number): number {
    return view.getUint16(offset, true);
}

/** 无符号 32 位读取 */
function u32(view: DataView, offset: number): number {
    return view.getUint32(offset, true);
}

/** 把 WMF 中以 NUL 结尾的字体名（单字节）解码为字符串 */
function decodeFaceName(bytes: Uint8Array): string {
    let end = bytes.length;
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) {
            end = i;
            break;
        }
    }
    let result = "";
    for (let i = 0; i < end; i++) {
        result += String.fromCharCode(bytes[i]);
    }
    return result;
}

interface DcState {
    windowOrgX: number;
    windowOrgY: number;
    windowExtX: number;
    windowExtY: number;
    viewportOrgX: number;
    viewportOrgY: number;
    viewportExtX: number;
    viewportExtY: number;
    mapMode: number;
    textAlign: number;
    textColor: number;
    bkMode: number;
    currentX: number;
    currentY: number;
    selectedFont: WmfFont | null;
    selectedPen: WmfPen | null;
}

function createInitialState(): DcState {
    return {
        windowOrgX: 0,
        windowOrgY: 0,
        windowExtX: 1,
        windowExtY: 1,
        viewportOrgX: 0,
        viewportOrgY: 0,
        viewportExtX: 1,
        viewportExtY: 1,
        mapMode: 1,
        textAlign: 0, // TA_TOP | TA_LEFT
        textColor: 0x000000,
        bkMode: BKMODE_OPAQUE,
        currentX: 0,
        currentY: 0,
        selectedFont: null,
        selectedPen: null,
    };
}

/**
 * 按字体字符集解码文字字节。
 * Symbol(2) 保留原始码点，由调用方做符号映射；GB2312(134) 用 gb18030 兼容解码。
 */
export function decodeWmfText(bytes: Uint8Array, font: WmfFont | null): string {
    const charSet = font?.charSet ?? 0;
    if (charSet === 2) {
        // Symbol：返回原始码点，由 mapSymbolChar 处理
        let result = "";
        for (let i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i]);
        return result;
    }
    const labels: Record<number, string> = {
        0: "windows-1252",
        1: "windows-1252",
        128: "shift_jis",
        129: "euc-kr",
        134: "gb18030",
        136: "big5",
        255: "utf-8",
    };
    const label = labels[charSet] ?? "windows-1252";
    try {
        return new TextDecoder(label, { fatal: false }).decode(bytes);
    } catch {
        let result = "";
        for (let i = 0; i < bytes.length; i++) result += String.fromCharCode(bytes[i]);
        return result;
    }
}

/**
 * 解析 WMF 字节流，输出按出现顺序的绘制指令（保留原始逻辑坐标，未做坐标映射）。
 * viewBox 优先取 Aldus placeable 头的 bbox，否则取窗口原点+范围。
 */
export function parseWmf(bytes: Uint8Array): WmfParseResult {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    let placeableBox: { left: number; top: number; right: number; bottom: number } | null = null;

    // 可选 Aldus placeable 头：key(4) + hmf(2) + bbox(8) + inch(2) + reserved(4) + checksum(2) = 22
    // bbox 顺序：(left, top, right, bottom)
    if (bytes.byteLength >= 4 && u32(view, 0) === PLACEABLE_KEY) {
        if (bytes.byteLength < 22) throw new Error("WMF placeable 头长度不足");
        placeableBox = {
            left: i16(view, 6),
            top: i16(view, 8),
            right: i16(view, 10),
            bottom: i16(view, 12),
        };
        offset = 22;
    }

    // 标准 metafile 头（18 字节 = 9 字）
    if (bytes.byteLength - offset < 18) throw new Error("WMF metafile 头长度不足");
    const headerSize = u16(view, offset + 2);
    if (headerSize !== 9) throw new Error(`WMF metafile 头长度字段异常：${headerSize}`);
    offset += 18;

    const state = createInitialState();
    const dcStack: DcState[] = [];
    const objects: Array<WmfObject | null> = new Array<WmfObject | null>(OBJECT_TABLE_SIZE).fill(null);

    const texts: WmfTextOp[] = [];
    const polylines: WmfPolylineOp[] = [];
    const polygons: WmfPolygonOp[] = [];
    let usedUpdateCp = false;

    /** 对象表分配：找最低空闲槽位 */
    function allocObject(obj: WmfObject): void {
        for (let i = 0; i < objects.length; i++) {
            if (objects[i] === null) {
                objects[i] = obj;
                return;
            }
        }
        throw new Error("WMF 对象表已满");
    }

    function currentPenColor(): number {
        return state.selectedPen?.color ?? 0x000000;
    }

    /** 估算当前字体下单字符平均宽度（逻辑单位） */
    function estimateCharWidth(): number {
        const font = state.selectedFont;
        if (!font) return 8;
        const h = Math.abs(font.height);
        const base = h * 0.5;
        return Math.max(1, Math.round(font.bold ? base * 1.05 : base));
    }

    function estimateTextWidth(text: string): number {
        return text.length * estimateCharWidth();
    }

    /** 处理一条 TEXTOUT/EXTTEXTOUT 记录（已解码文本，dx 数组可能为空） */
    function emitText(rawText: string, x: number, y: number, charWidths: number[]): void {
        const font = state.selectedFont;
        const align = state.textAlign;
        const useCurrentPos = (align & TA_UPDATECP) !== 0 || (x === 0 && y === 0);
        const baseX = useCurrentPos ? state.currentX : x;
        const baseY = useCurrentPos ? state.currentY : y;
        const vAlign = align & TA_MASK_V;
        const lineHeight = font ? Math.abs(font.height) : 12;
        let yTop: number;
        if (vAlign === TA_BASELINE) yTop = baseY - Math.round(lineHeight * 0.8);
        else if (vAlign === TA_BOTTOM) yTop = baseY - lineHeight;
        else yTop = baseY;

        if (charWidths.length > 0) {
            // 有 dx 数组：逐字定位
            let charX = baseX;
            const hAlign = align & TA_MASK_H;
            if (hAlign === TA_CENTER) {
                charX -= Math.round(charWidths.reduce((a, b) => a + b, 0) / 2);
            } else if (hAlign === TA_RIGHT) {
                charX -= charWidths.reduce((a, b) => a + b, 0);
            }
            for (let i = 0; i < rawText.length; i++) {
                texts.push({ x: charX, y: yTop, text: rawText[i], font, color: state.textColor, align, bkMode: state.bkMode });
                charX += charWidths[i] ?? estimateCharWidth();
            }
            if (align & TA_UPDATECP) state.currentX = charX;
        } else {
            const hAlign = align & TA_MASK_H;
            const width = estimateTextWidth(rawText);
            let textX = baseX;
            if (hAlign === TA_CENTER) textX = baseX - Math.round(width / 2);
            else if (hAlign === TA_RIGHT) textX = baseX - width;
            texts.push({ x: textX, y: yTop, text: rawText, font, color: state.textColor, align, bkMode: state.bkMode });
            if (align & TA_UPDATECP) state.currentX = baseX + width;
        }
        if (align & TA_UPDATECP) state.currentY = baseY;
    }

    /** 连续 LINETO 合并到同一条折线的辅助状态 */
    let openPolyline: WmfPolylineOp | null = null;

    function flushPolyline(): void {
        openPolyline = null;
    }

    while (offset + 6 <= bytes.byteLength) {
        const sizeWords = u32(view, offset);
        const func = u16(view, offset + 4);
        const recordEnd = offset + sizeWords * 2;
        if (sizeWords < 3 || recordEnd > bytes.byteLength) break;
        const data = offset + 6;

        switch (func) {
            case META_SETWINDOWORG:
                // 参数顺序：(y, x)
                state.windowOrgY = i16(view, data);
                state.windowOrgX = i16(view, data + 2);
                break;
            case META_SETWINDOWEXT:
                // 参数顺序：(y, x)
                state.windowExtY = i16(view, data);
                state.windowExtX = i16(view, data + 2);
                break;
            case META_SETVIEWPORTORG:
                // 参数顺序：(y, x)
                state.viewportOrgY = i16(view, data);
                state.viewportOrgX = i16(view, data + 2);
                break;
            case META_SETVIEWPORTEXT:
                // 参数顺序：(y, x)
                state.viewportExtY = i16(view, data);
                state.viewportExtX = i16(view, data + 2);
                break;
            case META_SETMAPMODE:
                state.mapMode = u16(view, data);
                break;
            case META_SETTEXTALIGN:
                state.textAlign = u16(view, data);
                if (state.textAlign & TA_UPDATECP) usedUpdateCp = true;
                break;
            case META_SETTEXTCOLOR:
                state.textColor = u32(view, data) & 0xffffff;
                break;
            case META_SETBKMODE:
                state.bkMode = u16(view, data);
                break;
            case META_SAVEDC:
                dcStack.push({ ...state });
                break;
            case META_RESTOREDC:
                flushPolyline();
                {
                    const saved = dcStack.pop();
                    if (saved) Object.assign(state, saved);
                }
                break;
            case META_MOVETO:
                flushPolyline();
                // 参数顺序：(y, x)
                state.currentY = i16(view, data);
                state.currentX = i16(view, data + 2);
                break;
            case META_LINETO: {
                // 参数顺序：(y, x)
                const y = i16(view, data);
                const x = i16(view, data + 2);
                const color = currentPenColor();
                if (openPolyline && openPolyline.color === color) {
                    openPolyline.points.push({ x, y });
                } else {
                    flushPolyline();
                    openPolyline = { points: [{ x: state.currentX, y: state.currentY }, { x, y }], color };
                    polylines.push(openPolyline);
                }
                state.currentX = x;
                state.currentY = y;
                break;
            }
            case META_CREATEFONTINDIRECT: {
                const height = i16(view, data);
                const weight = i16(view, data + 8);
                const italic = bytes[data + 10] !== 0;
                const underline = bytes[data + 11] !== 0;
                const strikeOut = bytes[data + 12] !== 0;
                // lfCharSet 在 LOGFONT 偏移 13（单字节）
                const charSet = bytes[data + 13];
                const faceNameBytes = bytes.subarray(data + 18, Math.min(data + 18 + 32, recordEnd));
                const faceName = decodeFaceName(faceNameBytes);
                allocObject({ kind: "font", height, bold: weight >= FW_BOLD_THRESHOLD, italic, underline, strikeOut, charSet, faceName });
                break;
            }
            case META_CREATEPENINDIRECT: {
                const style = u16(view, data);
                const width = i16(view, data + 2);
                const color = u32(view, data + 6) & 0xffffff;
                allocObject({ kind: "pen", style, width, color });
                break;
            }
            case META_CREATEBRUSHINDIRECT: {
                const style = u16(view, data);
                const color = u32(view, data + 2) & 0xffffff;
                allocObject({ kind: "brush", style, color });
                break;
            }
            case META_SELECTOBJECT: {
                flushPolyline();
                const index = u16(view, data);
                const obj = objects[index] ?? null;
                if (obj?.kind === "font") state.selectedFont = obj;
                else if (obj?.kind === "pen") state.selectedPen = obj;
                break;
            }
            case META_DELETEOBJECT: {
                const index = u16(view, data);
                if (index < objects.length) objects[index] = null;
                break;
            }
            case META_POLYGON:
            case META_POLYLINE: {
                flushPolyline();
                const count = u16(view, data);
                const points: Array<{ x: number; y: number }> = [];
                for (let i = 0; i < count; i++) {
                    points.push({ x: i16(view, data + 2 + i * 4), y: i16(view, data + 4 + i * 4) });
                }
                const color = currentPenColor();
                if (func === META_POLYLINE) polylines.push({ points, color });
                else polygons.push({ points, color });
                break;
            }
            case META_RECTANGLE: {
                flushPolyline();
                const bottom = i16(view, data);
                const right = i16(view, data + 2);
                const top = i16(view, data + 4);
                const left = i16(view, data + 6);
                polygons.push({
                    points: [
                        { x: left, y: top },
                        { x: right, y: top },
                        { x: right, y: bottom },
                        { x: left, y: bottom },
                    ],
                    color: currentPenColor(),
                });
                break;
            }
            case META_TEXTOUT: {
                flushPolyline();
                const count = u16(view, data);
                const textBytes = bytes.subarray(data + 2, data + 2 + count);
                let pos = data + 2 + count;
                if (count % 2 === 1) pos += 1;
                // 字符串之后是 (y, x)
                const y = i16(view, pos);
                const x = i16(view, pos + 2);
                emitText(decodeWmfText(textBytes, state.selectedFont), x, y, []);
                break;
            }
            case META_EXTTEXTOUT: {
                flushPolyline();
                // 参数顺序：(y, x, count, options, ...)
                const y = i16(view, data);
                const x = i16(view, data + 2);
                const count = u16(view, data + 4);
                const options = u16(view, data + 6);
                let textOffset = data + 8;
                if ((options & (ETO_CLIPPED | ETO_OPAQUE)) !== 0) textOffset += 8;
                const textBytes = bytes.subarray(textOffset, textOffset + count);
                let dxOffset = textOffset + count;
                if (count % 2 === 1) dxOffset += 1;
                const charWidths: number[] = [];
                if (count > 0 && dxOffset + count * 2 <= recordEnd) {
                    for (let i = 0; i < count; i++) {
                        charWidths.push(u16(view, dxOffset + i * 2));
                    }
                }
                emitText(decodeWmfText(textBytes, state.selectedFont), x, y, charWidths);
                break;
            }
            default:
                // META_ESCAPE(0x0626) 及其他未知记录：忽略
                break;
        }

        offset = recordEnd;
        if (func === META_EOF) break;
    }

    let viewBox: WmfParseResult["viewBox"];
    if (placeableBox) {
        viewBox = {
            x: placeableBox.left,
            y: placeableBox.top,
            width: placeableBox.right - placeableBox.left,
            height: placeableBox.bottom - placeableBox.top,
        };
    } else {
        viewBox = { x: state.windowOrgX, y: state.windowOrgY, width: state.windowExtX, height: state.windowExtY };
    }

    return { viewBox, texts, polylines, polygons, usedUpdateCp };
}

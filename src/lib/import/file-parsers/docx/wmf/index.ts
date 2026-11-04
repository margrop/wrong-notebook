/**
 * WMF（Windows Metafile）轻量渲染器：解析 + SVG 输出。
 *
 * 替代 rtf.js 的 WMFJS，专门支持 MathType / 公式编辑器 OLE 公式对象的
 * WMF 预览图（含 TA_UPDATECP 文字定位、dx 数组逐字定位等）。
 * EMF 不在本模块支持范围内（MathType 公式预览图基本为 WMF）。
 */
export { parseWmf, decodeWmfText } from "./parser";
export type { WmfFont, WmfPen, WmfBrush, WmfObject, WmfTextOp, WmfPolylineOp, WmfPolygonOp, WmfParseResult } from "./parser";
export { renderWmfSvg, wmfBytesToSvg, mapWmfChar, mapFontFamily } from "./renderer";
export { wmfToLatex, wmfBytesToLatex } from "./latex";
export type { WmfLatexResult } from "./latex";

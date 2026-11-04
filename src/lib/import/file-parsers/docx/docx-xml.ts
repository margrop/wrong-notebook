/**
 * docx（OOXML 打包的 XML）解压与只读解析工具。
 * 只读取与题库解析相关的三个部件：word/document.xml、word/numbering.xml、word/styles.xml。
 * 兼容 WPS：zip 条目名称区分大小写，按统一小写名称建索引。
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import { unzipSync } from "fflate";

export interface DocxDocumentParts {
    /** 文档主部件 */
    document: Document;
    /** 自动编号定义（可选部件） */
    numbering: Document | null;
    /** 样式定义（用于解析段落的编号引用与默认删除线） */
    styles: Document | null;
    /** word/_rels/document.xml.rels 解析出的 rId → target 映射（供图片/公式提取按关系查找媒体文件） */
    relationships: Record<string, string>;
    /** 解压后的全部 zip 条目（小写文件名 → 字节），供按 target 读取 word/media/* 等部件 */
    files: Record<string, Uint8Array>;
}

/** 旧版 .doc（OLE2 复合文档）文件头 */
const LEGACY_DOC_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

/** 判断是否为旧版 .doc 二进制文件 */
export function isLegacyDocFile(bytes: Uint8Array): boolean {
    if (bytes.length < LEGACY_DOC_MAGIC.length) return false;
    return LEGACY_DOC_MAGIC.every((value, index) => bytes[index] === value);
}

/** zip 中央目录损坏或不是 zip 包时 fflate 抛出的错误归一化为 INVALID_DOCX */
export function unzipDocx(bytes: Uint8Array): Record<string, Uint8Array> {
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(bytes);
    } catch {
        throw new Error("INVALID_DOCX");
    }
    return entries;
}

function decodeXmlText(bytes: Uint8Array): string {
    return new TextDecoder("utf-8").decode(bytes);
}

function parseXml(xml: string): Document {
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    const parserError = parsed.getElementsByTagName("parsererror")[0];
    if (parserError) throw new Error("INVALID_DOCX");
    return parsed;
}

/** 把 zip 条目按小写名称建索引，兼容大小写差异（WPS 导出常见大写扩展名） */
function indexEntries(entries: Record<string, Uint8Array>): Map<string, Uint8Array> {
    const index = new Map<string, Uint8Array>();
    for (const [name, data] of Object.entries(entries)) {
        index.set(name.toLowerCase(), data);
    }
    return index;
}

const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** 解析 word/_rels/document.xml.rels：返回 rId → target 映射；无该部件时返回空对象 */
function parseRelationships(index: Map<string, Uint8Array>): Record<string, string> {
    const relsXml = index.get("word/_rels/document.xml.rels");
    if (!relsXml) return {};
    const doc = parseXml(decodeXmlText(relsXml));
    const relationships: Record<string, string> = {};
    for (const rel of Array.from(doc.getElementsByTagNameNS(PKG_REL_NS, "Relationship"))) {
        const id = rel.getAttribute("Id");
        const target = rel.getAttribute("Target");
        if (id && target) relationships[id] = target;
    }
    return relationships;
}

/** 把解压后的全部条目按小写文件名导出（loadDocxParts 的 files 字段） */
function exportFiles(index: Map<string, Uint8Array>): Record<string, Uint8Array> {
    const files: Record<string, Uint8Array> = {};
    for (const [name, data] of index) {
        files[name] = data;
    }
    return files;
}

/**
 * 解压并解析 docx 的相关部件。
 * 非 docx（损坏的 zip、缺主部件、XML 解析失败）抛错 INVALID_DOCX。
 */
export function loadDocxParts(bytes: Uint8Array): DocxDocumentParts {
    const index = indexEntries(unzipDocx(bytes));
    const documentXml = index.get("word/document.xml");
    if (!documentXml) throw new Error("INVALID_DOCX");
    const numberingXml = index.get("word/numbering.xml");
    const stylesXml = index.get("word/styles.xml");
    return {
        document: parseXml(decodeXmlText(documentXml)),
        numbering: numberingXml ? parseXml(decodeXmlText(numberingXml)) : null,
        styles: stylesXml ? parseXml(decodeXmlText(stylesXml)) : null,
        relationships: parseRelationships(index),
        files: exportFiles(index),
    };
}

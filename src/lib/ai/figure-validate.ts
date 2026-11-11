import "server-only";

import { SaxesParser } from "saxes";

/**
 * 检查 SVG 是否为合法 XML：<img> 加载不合法的 SVG 时整张图都不显示。
 * 合法时返回 null，否则返回第一条解析错误（含行列号），用于让模型修正。
 */
export function findSvgXmlError(svg: string): string | null {
    // 开启命名空间检查：xlink:href 等前缀未声明时浏览器同样拒绝加载
    const parser = new SaxesParser({ xmlns: true });
    let error: string | null = null;
    parser.on("error", (err) => {
        error ??= err.message;
    });
    try {
        parser.write(svg).close();
    } catch (err) {
        error ??= err instanceof Error ? err.message : String(err);
    }
    return error;
}

/** XML 只预定义了这 5 个实体，其余 HTML 实体（如 &nbsp;）会导致解析失败 */
const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);
const HTML_ENTITIES: Record<string, string> = { nbsp: "&#160;", times: "&#215;", divide: "&#247;", deg: "&#176;", plusmn: "&#177;", middot: "&#183;" };

/**
 * 修复无需模型参与的常见 XML 错误：未转义的 & 和 HTML 实体。
 */
export function repairSvgEntities(svg: string): string {
    return svg.replace(/&(#\d+;|#x[0-9a-fA-F]+;|([a-zA-Z][a-zA-Z0-9]*);)?/g, (match: string, entity: string | undefined, name: string | undefined) => {
        if (!entity) return "&amp;";
        if (!name || XML_ENTITIES.has(name)) return match;
        return HTML_ENTITIES[name] ?? `&amp;${name};`;
    });
}

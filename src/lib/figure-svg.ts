/**
 * 题目配图（AI 生成的 SVG）的净化与显示。前后端共用，不要引入服务端模块。
 *
 * 显示时始终通过 <img src="data:image/svg+xml,..."> 渲染，浏览器不会执行其中的脚本；
 * 保存前仍做净化，防止导出的 HTML 或其他用途中出现脚本和外部资源。
 */

/** 单个配图的最大长度（字符） */
export const MAX_FIGURE_SVG_LENGTH = 100_000;

const SVG_NS = 'http://www.w3.org/2000/svg';

// 可执行或可嵌入外部内容的元素，连同内容一起删除
const DANGEROUS_ELEMENTS = /<(script|foreignObject|iframe|object|embed|audio|video|image)\b[\s\S]*?(<\/\1\s*>|\/>)/gi;
const DANGEROUS_OPEN_TAGS = /<\/?(script|foreignObject|iframe|object|embed|audio|video|image)\b[^>]*>/gi;

const MAX_SANITIZE_PASSES = 10;

// 属性值都带引号的开始标签；不带引号的写法不处理，原样保留
const START_TAG = /<([a-zA-Z][\w:.-]*)((?:\s+[^\s=>/"']+\s*=\s*(?:"[^"]*"|'[^']*'))+)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s=>/"']+)\s*=\s*("[^"]*"|'[^']*')/g;

/**
 * 修复同一元素中重复出现的属性。XML 不允许重复属性，<img> 加载这样的 SVG 时整张图都不显示。
 * 模型画折线时常把 <line> 写成 x1 y1 x2 y2 x2 y2…，此时按原意改成 <polyline>；其他重复属性只保留第一个。
 */
export function repairDuplicateSvgAttributes(svg: string): string {
    return svg.replace(START_TAG, (tag: string, name: string, attrText: string, selfClosing: string) => {
        const attributes = [...attrText.matchAll(ATTRIBUTE)].map(([, key, value]) => ({ key, value }));
        const counts = new Map<string, number>();
        for (const { key } of attributes) counts.set(key, (counts.get(key) ?? 0) + 1);
        if (![...counts.values()].some((count) => count > 1)) return tag;

        const close = selfClosing ? '/>' : '>';
        const kept = new Map<string, string>();
        for (const { key, value } of attributes) {
            if (!kept.has(key)) kept.set(key, value);
        }
        const unquote = (value: string) => value.slice(1, -1).trim();
        const xs = attributes.filter((attr) => attr.key === 'x2').map((attr) => unquote(attr.value));
        const ys = attributes.filter((attr) => attr.key === 'y2').map((attr) => unquote(attr.value));
        if (name.toLowerCase() === 'line' && xs.length > 1 && xs.length === ys.length && kept.has('x1') && kept.has('y1')) {
            const points = [`${unquote(kept.get('x1')!)},${unquote(kept.get('y1')!)}`, ...xs.map((x, i) => `${x},${ys[i]}`)];
            const rest = [...kept].filter(([key]) => !['x1', 'y1', 'x2', 'y2', 'fill'].includes(key));
            // line 本身没有填充，改成折线后要显式不填充，否则默认填成黑色
            const attrs = [`points="${points.join(' ')}"`, 'fill="none"', ...rest.map(([key, value]) => `${key}=${value}`)];
            return `<polyline ${attrs.join(' ')}${close}`;
        }
        return `<${name} ${[...kept].map(([key, value]) => `${key}=${value}`).join(' ')}${close}`;
    });
}

/**
 * 从 AI 回复中取出 <svg>…</svg> 并净化；没有有效 SVG、超长或净化后为空时返回 null
 */
export function sanitizeFigureSvg(raw: unknown, maxLength: number = MAX_FIGURE_SVG_LENGTH): string | null {
    if (typeof raw !== 'string') return null;
    const start = raw.search(/<svg[\s>]/i);
    const end = raw.toLowerCase().lastIndexOf('</svg>');
    if (start === -1 || end === -1 || end < start) return null;

    let svg = raw.slice(start, end + '</svg>'.length);
    if (svg.length > maxLength) return null;

    // 删除一处可能拼出新的危险片段（如 <scr<script>ipt>），反复净化直到结果不再变化
    let previous: string;
    let pass = 0;
    do {
        if (pass++ > MAX_SANITIZE_PASSES) return null;
        previous = svg;
        svg = svg.replace(/<!--[\s\S]*?-->/g, '');
        svg = svg.replace(/<!DOCTYPE[^>]*>/gi, '');
        svg = svg.replace(/<\?[\s\S]*?\?>/g, '');
        svg = svg.replace(DANGEROUS_ELEMENTS, '');
        svg = svg.replace(DANGEROUS_OPEN_TAGS, '');
        // 事件属性（onload 等）
        svg = svg.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        // 只允许指向本文档内部的链接（#id），去掉外部和 javascript: 链接
        svg = svg.replace(/\s+(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*'|(?!["'#])[^\s>"']+)/gi, '');
        // 样式中的外部资源与脚本
        svg = svg.replace(/@import[^;]*;?/gi, '');
        svg = svg.replace(/url\(\s*(['"]?)(?!#)[^)]*\)/gi, 'none');
        svg = svg.replace(/(?:javascript|vbscript|data)\s*:/gi, '');
    } while (svg !== previous);

    svg = repairDuplicateSvgAttributes(svg);
    if (!/<svg[^>]*\sxmlns\s*=/i.test(svg)) {
        svg = svg.replace(/<svg/i, `<svg xmlns="${SVG_NS}"`);
    }
    // 至少要有一个可见的图形元素
    if (!/<(line|polyline|polygon|rect|circle|ellipse|path|text)\b/i.test(svg)) return null;
    return svg;
}

/** 用于 <img src> 的 data URI；同时修复已保存配图中的重复属性，旧数据不必重新生成 */
export function figureSvgToDataUri(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(repairDuplicateSvgAttributes(svg))}`;
}

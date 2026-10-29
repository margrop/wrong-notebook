/**
 * 题目的 SVG 动画讲解（AI 生成）。前后端共用，不要引入服务端模块。
 *
 * 净化规则与题目配图相同（见 figure-svg.ts），保留 SMIL 动画元素和 CSS 动画；
 * 显示时同样通过 <img> 加载，浏览器不会执行其中的脚本。
 */
import { sanitizeFigureSvg } from './figure-svg';

/** 单个动画讲解的最大长度（字符） */
export const MAX_SVG_ANIMATION_LENGTH = 200_000;

// 改写链接属性的动画（<animate attributeName="href" …>、<set attributeName="xlink:href" …>）
const HREF_ANIMATIONS = /<(animate|set)\b[^>]*attributeName\s*=\s*["']?(?:xlink:)?href["']?[^>]*?(\/>|>[\s\S]*?<\/\1\s*>)/gi;

/**
 * 从 AI 回复中取出动画 SVG 并净化；没有有效 SVG 或超长时返回 null。
 * 其中的语音讲解稿会重新规范化，无效时删除。
 */
export function sanitizeSvgAnimation(raw: unknown): string | null {
    const svg = sanitizeFigureSvg(raw, MAX_SVG_ANIMATION_LENGTH);
    if (!svg) return null;
    const clean = svg.replace(HREF_ANIMATIONS, '');
    return embedNarration(clean, getEmbeddedNarration(clean));
}

/** 语音讲解稿的一段：动画播放到 begin 秒时朗读 text */
export interface NarrationSegment {
    begin: number;
    text: string;
}

export const MAX_NARRATION_SEGMENTS = 20;
export const MAX_NARRATION_TEXT_LENGTH = 300;

/**
 * 讲解稿保存在 SVG 内的 <metadata id="narration"> 中，内容为 JSON 数组 [{"begin":0,"text":"…"}]；
 * 浏览器不显示 metadata，不需要单独的数据库字段，导入导出随动画一起保存。
 */
const NARRATION_METADATA = /<metadata\b[^>]*\bid\s*=\s*["']narration["'][^>]*>([\s\S]*?)<\/metadata\s*>/gi;

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXmlText(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (entity, name: string) => {
        if (name[0] !== '#') return XML_ENTITIES[name.toLowerCase()];
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
}

/**
 * 校验讲解稿：JSON 字符串或数组，每段需有非负的 begin（秒）和非空 text；
 * 按 begin 排序，同一时间的多段合并，过长的文字截断。没有有效段落时返回 null。
 */
export function parseNarration(raw: unknown): NarrationSegment[] | null {
    let value = raw;
    if (typeof value === 'string') {
        const start = value.indexOf('[');
        const end = value.lastIndexOf(']');
        if (start === -1 || end < start) return null;
        try {
            value = JSON.parse(value.slice(start, end + 1));
        } catch {
            return null;
        }
    }
    if (!Array.isArray(value)) return null;

    const segments: NarrationSegment[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const { begin, text } = entry as { begin?: unknown; text?: unknown };
        const time = typeof begin === 'number' ? begin : typeof begin === 'string' ? parseClockValue(begin) : null;
        if (time === null || !Number.isFinite(time) || time < 0 || typeof text !== 'string') continue;
        const content = text.replace(/\s+/g, ' ').trim();
        if (content) segments.push({ begin: Math.round(time * 100) / 100, text: content });
    }
    segments.sort((a, b) => a.begin - b.begin);

    const merged: NarrationSegment[] = [];
    for (const segment of segments) {
        const last = merged[merged.length - 1];
        if (last && last.begin === segment.begin) last.text = `${last.text} ${segment.text}`;
        else merged.push({ ...segment });
    }
    const result = merged.slice(0, MAX_NARRATION_SEGMENTS)
        .map((segment) => ({ ...segment, text: segment.text.slice(0, MAX_NARRATION_TEXT_LENGTH) }));
    return result.length > 0 ? result : null;
}

/** 读取 SVG 中保存的讲解稿；没有或无效时返回 null */
export function getEmbeddedNarration(svg: string): NarrationSegment[] | null {
    for (const match of svg.matchAll(NARRATION_METADATA)) {
        const narration = parseNarration(decodeXmlText(match[1]));
        if (narration) return narration;
    }
    return null;
}

/**
 * 把讲解稿写入 SVG（替换已有的讲解稿，放在根元素开头）；narration 为 null 时只删除已有的讲解稿
 */
export function embedNarration(svg: string, narration: NarrationSegment[] | null): string {
    const stripped = svg.replace(NARRATION_METADATA, '');
    if (!narration?.length) return stripped;
    // 文字中的 < & 需转义，否则 HTML 解析器会把它当作标签
    const json = JSON.stringify(narration).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return stripped.replace(/<svg\b[^>]*>/i, (open) => `${open}<metadata id="narration">${json}</metadata>`);
}

const ANIMATION_TAG = /<(?:animate|animateTransform|animateMotion|set)\b[^>]*>/gi;

function readAttribute(tag: string, name: string): string | null {
    const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
    return match ? (match[2] ?? match[3] ?? '').trim() : null;
}

/** 解析 SMIL 时钟值（如 2s、500ms、1.5、0:05、1min），无法解析时返回 null */
export function parseClockValue(value: string | null): number | null {
    if (!value) return null;
    const v = value.trim();
    const clock = v.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
    if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    const timed = v.match(/^(\d+(?:\.\d+)?)(h|min|s|ms)?$/);
    if (!timed) return null;
    const unit = { h: 3600, min: 60, s: 1, ms: 0.001 }[timed[2] ?? 's'] ?? 1;
    return Number(timed[1]) * unit;
}

/**
 * 动画总时长（秒）：各 SMIL 动画元素 begin + dur × repeatCount 的最大值；
 * begin 取列表中第一个时钟值，引用其他元素（如 a.end）或无限循环的动画不计入。
 */
export function getSvgAnimationDuration(svg: string): number {
    let total = 0;
    for (const tag of svg.match(ANIMATION_TAG) || []) {
        const beginRaw = readAttribute(tag, 'begin');
        const begin = beginRaw === null ? 0 : parseClockValue(beginRaw.split(';')[0]);
        if (begin === null) continue;
        const repeat = readAttribute(tag, 'repeatCount');
        if (repeat === 'indefinite' || readAttribute(tag, 'repeatDur') === 'indefinite') continue;
        const dur = parseClockValue(readAttribute(tag, 'dur')) ?? 0;
        const count = repeat && Number.isFinite(Number(repeat)) ? Number(repeat) : 1;
        total = Math.max(total, begin + dur * count);
    }
    return total;
}

/** 字幕区：画面下方这一比例以下的文字视为字幕 */
const SUBTITLE_AREA_TOP = 0.78;

const VISIBILITY_ATTRIBUTES = new Set(['opacity', 'visibility', 'display', 'fill-opacity']);

function isHiddenValue(attribute: string, value: string | null): boolean {
    if (value === null) return false;
    const v = value.trim();
    if (attribute === 'visibility') return v === 'hidden';
    if (attribute === 'display') return v === 'none';
    return Number(v) === 0;
}

/**
 * 元素开始显示的时间：从自身向上找控制可见性的 <set>/<animate>，取显示动画的 begin；
 * 一直可见时为 0，无法确定（如 begin 引用其他元素）时返回 null
 */
function getAppearTime(element: Element, root: Element): number | null {
    for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
        for (const child of Array.from(node.children)) {
            const tag = child.localName;
            if (tag !== 'set' && tag !== 'animate') continue;
            const attribute = child.getAttribute('attributeName') ?? '';
            if (!VISIBILITY_ATTRIBUTES.has(attribute)) continue;
            const target = child.getAttribute('to') ?? child.getAttribute('values')?.split(';').pop() ?? null;
            if (isHiddenValue(attribute, target)) continue;
            return parseClockValue((child.getAttribute('begin') ?? '0').split(';')[0]);
        }
    }
    return 0;
}

/**
 * 没有讲解稿的旧动画：从画面底部字幕区的 <text> 提取朗读内容，按出现时间分段。
 * 参数为已渲染的 SVG 根元素（只在浏览器中调用）。
 */
export function extractSubtitleNarration(root: Element): NarrationSegment[] | null {
    const viewBox = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    const height = viewBox?.length === 4 && viewBox[3] > 0 ? viewBox[1] + viewBox[3] : parseFloat(root.getAttribute('height') ?? '');
    if (!(height > 0)) return null;
    const top = viewBox?.length === 4 ? viewBox[1] + viewBox[3] * SUBTITLE_AREA_TOP : height * SUBTITLE_AREA_TOP;

    const lines: { begin: number; y: number; text: string }[] = [];
    for (const text of Array.from(root.querySelectorAll('text'))) {
        if (text.closest('defs, metadata')) continue;
        const y = parseFloat(text.getAttribute('y') ?? text.querySelector('tspan[y]')?.getAttribute('y') ?? '');
        if (!(y >= top)) continue;
        const tspans = Array.from(text.querySelectorAll('tspan'));
        const content = (tspans.length > 0 ? tspans.map((tspan) => tspan.textContent ?? '').join(' ') : text.textContent ?? '')
            .replace(/\s+/g, ' ').trim();
        const begin = getAppearTime(text, root);
        if (content && begin !== null) lines.push({ begin, y, text: content });
    }
    lines.sort((a, b) => a.begin - b.begin || a.y - b.y);
    return parseNarration(lines.map(({ begin, text }) => ({ begin, text })));
}

/** 由 viewBox（或 width/height）得出宽高比，缺省为 8:5 */
export function getSvgAspectRatio(svg: string): number {
    const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
    const viewBox = readAttribute(root, 'viewBox')?.split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) return viewBox[2] / viewBox[3];
    const width = parseFloat(readAttribute(root, 'width') ?? '');
    const height = parseFloat(readAttribute(root, 'height') ?? '');
    return width > 0 && height > 0 ? width / height : 8 / 5;
}

/**
 * 放进 sandbox iframe 的文档：CSP 禁止加载任何外部资源，SVG 铺满画面
 */
export function buildSvgAnimationDocument(svg: string): string {
    return '<!doctype html><html><head><meta charset="utf-8">'
        + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">'
        + '<style>html,body{margin:0;height:100%;background:#fff;overflow:hidden}svg{display:block;width:100%;height:100%}</style>'
        + `</head><body>${svg}</body></html>`;
}

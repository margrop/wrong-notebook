/**
 * 分题预览中「AI 修正文字」的共用规则（不依赖数据库，可在浏览器中引用）：
 * - 修正结果的安全校验：不得新增原文没有的数字，长度不得明显增加；
 * - 原文与修正结果的字符级差异，用于在预览页标出删改。
 */

/** 一次请求最多修正的题数（与每批题数上限一致） */
export const MAX_TEXT_FIX_ITEMS = 60;
/**
 * 每次 AI 调用处理的题数：题多时分组并行调用。
 * 推理型模型逐题斟酌草稿与题干，实测 MiniMax-M3.1-Flash 一次 7 题的推理就超过 8192 token，
 * 改为小组后单次耗时和输出长度都可控
 */
export const TEXT_FIX_CHUNK_SIZE = 3;

const FULL_WIDTH_DIGIT = /[０-９．]/g;

function toHalfWidth(text: string): string {
    return text.replace(FULL_WIDTH_DIGIT, (char) => (char === "．" ? "." : String.fromCharCode(char.charCodeAt(0) - 0xfee0)));
}

/** 文字中出现的数字（全角转半角），如 "48道题、1.5米" → ["48", "1.5"] */
export function extractNumbers(text: string): string[] {
    return toHalfWidth(text).match(/\d+(?:\.\d+)?/g) ?? [];
}

export type TextFixRejection = "empty" | "tooLong" | "newNumbers";

/**
 * 判断修正结果是否可以作为建议展示：
 * - 不为空；
 * - 不比原文长太多（修正只删草稿、改错字，不补写内容）；
 * - 不出现原文没有的数字（删去草稿中的数字可以，改动或新增数字不行）。
 * 返回 null 表示可用，否则返回拒绝原因。
 */
export function checkTextFix(original: string, fixed: string): TextFixRejection | null {
    if (!fixed.trim()) return "empty";
    if (fixed.length > original.length + Math.max(20, Math.ceil(original.length * 0.1))) return "tooLong";
    const available = new Map<string, number>();
    for (const number of extractNumbers(original)) available.set(number, (available.get(number) ?? 0) + 1);
    for (const number of extractNumbers(fixed)) {
        const left = available.get(number) ?? 0;
        if (left === 0) return "newNumbers";
        available.set(number, left - 1);
    }
    return null;
}

export interface DiffSegment {
    type: "same" | "removed" | "added";
    text: string;
}

/** 超过这个规模时不逐字比较，中间部分整体显示为删除和新增 */
const MAX_DIFF_CELLS = 2_000_000;

function push(segments: DiffSegment[], type: DiffSegment["type"], text: string) {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += text;
    else segments.push({ type, text });
}

/** 字符级差异：先去掉相同的首尾，中间部分用最长公共子序列比较 */
export function diffText(before: string, after: string): DiffSegment[] {
    const a = Array.from(before);
    const b = Array.from(after);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }
    const segments: DiffSegment[] = [];
    push(segments, "same", a.slice(0, start).join(""));
    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    const n = midA.length;
    const m = midB.length;
    if (n * m > MAX_DIFF_CELLS) {
        push(segments, "removed", midA.join(""));
        push(segments, "added", midB.join(""));
    } else {
        // lengths[i][j]：midA[i..] 与 midB[j..] 的最长公共子序列长度
        const width = m + 1;
        const lengths = new Uint32Array((n + 1) * width);
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                lengths[i * width + j] = midA[i] === midB[j]
                    ? lengths[(i + 1) * width + j + 1] + 1
                    : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
            }
        }
        let i = 0;
        let j = 0;
        while (i < n && j < m) {
            if (midA[i] === midB[j]) {
                push(segments, "same", midA[i]);
                i++;
                j++;
            } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
                push(segments, "removed", midA[i++]);
            } else {
                push(segments, "added", midB[j++]);
            }
        }
        push(segments, "removed", midA.slice(i).join(""));
        push(segments, "added", midB.slice(j).join(""));
    }
    push(segments, "same", a.slice(endA).join(""));
    return segments;
}

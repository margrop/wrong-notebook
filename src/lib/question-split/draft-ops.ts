/**
 * 分题草稿的编辑操作（纯函数）：选择、编辑、拆分、合并、移动、删除、恢复忽略内容、调整区域、AI 修正建议的采用与放弃。
 * 每个操作返回新的草稿，不修改原对象，便于撤销。
 */
import { MAX_DRAFT_TEXT_LENGTH, MAX_ITEM_REGIONS, newItemKey } from "@/lib/question-split/draft";
import type { BatchDraft, DraftItem, DraftRegion, DraftTextFix } from "@/lib/question-split/draft";
import { MAX_SPLIT_QUESTIONS } from "@/lib/question-split/text";

function updateItems(draft: BatchDraft, items: DraftItem[]): BatchDraft {
    return { ...draft, items };
}

function indexOf(draft: BatchDraft, key: string): number {
    return draft.items.findIndex((item) => item.key === key);
}

export function setSelected(draft: BatchDraft, key: string, selected: boolean): BatchDraft {
    return updateItems(draft, draft.items.map((item) => (item.key === key ? { ...item, selected } : item)));
}

export function setAllSelected(draft: BatchDraft, selected: boolean, canSelect: (item: DraftItem) => boolean = () => true): BatchDraft {
    return updateItems(draft, draft.items.map((item) => ({ ...item, selected: selected && canSelect(item) })));
}

export function updateItem(draft: BatchDraft, key: string, patch: Partial<Pick<DraftItem, "text" | "material" | "regions" | "selected">>): BatchDraft {
    return updateItems(draft, draft.items.map((item) => {
        if (item.key !== key) return item;
        const next = { ...item, ...patch };
        if (patch.text !== undefined) {
            next.text = patch.text.slice(0, MAX_DRAFT_TEXT_LENGTH);
            // 手工改了题目文字，基于旧文字的修正建议不再适用
            if (next.text !== item.text) next.fix = null;
        }
        if (patch.regions !== undefined) {
            next.regions = patch.regions.slice(0, MAX_ITEM_REGIONS);
            // 补上区域后不再是「未定位」
            next.flags = next.regions.length > 0 ? item.flags.filter((flag) => flag !== "unlocated") : [...new Set([...item.flags, "unlocated" as const])];
        }
        return next;
    }));
}

/** 删除一题 */
export function removeItem(draft: BatchDraft, key: string): BatchDraft {
    return updateItems(draft, draft.items.filter((item) => item.key !== key));
}

/** 上移（-1）或下移（1） */
export function moveItem(draft: BatchDraft, key: string, offset: -1 | 1): BatchDraft {
    const index = indexOf(draft, key);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= draft.items.length) return draft;
    const items = [...draft.items];
    [items[index], items[target]] = [items[target], items[index]];
    return updateItems(draft, items);
}

/** 与上一题合并：文字按段落拼接，区域合并，公共材料取上一题已有的 */
export function mergeWithPrevious(draft: BatchDraft, key: string): BatchDraft {
    const index = indexOf(draft, key);
    if (index <= 0) return draft;
    const previous = draft.items[index - 1];
    const current = draft.items[index];
    const merged: DraftItem = {
        ...previous,
        text: [previous.text, current.text].filter((text) => text.trim()).join("\n").slice(0, MAX_DRAFT_TEXT_LENGTH),
        material: previous.material ?? current.material,
        selected: previous.selected || current.selected,
        regions: [...previous.regions, ...current.regions].slice(0, MAX_ITEM_REGIONS),
        hasFigure: previous.hasFigure || current.hasFigure,
        flags: [...new Set([...previous.flags, ...current.flags])].filter((flag) => flag !== "unlocated" || previous.regions.length + current.regions.length === 0),
        fix: null,
    };
    const items = [...draft.items];
    items.splice(index - 1, 2, merged);
    return updateItems(draft, items);
}

/**
 * 在文字的 offset 处拆成两题：前半保留原题，后半为新题（沿用公共材料和分组）。
 * 两边任一为空时不拆分。
 */
export function splitItemAt(draft: BatchDraft, key: string, offset: number): BatchDraft {
    const index = indexOf(draft, key);
    if (index < 0 || draft.items.length >= MAX_SPLIT_QUESTIONS) return draft;
    const item = draft.items[index];
    const before = item.text.slice(0, offset).replace(/\s+$/, "");
    const after = item.text.slice(offset).replace(/^\s+/, "");
    if (!before || !after) return draft;
    const second: DraftItem = {
        ...item,
        key: newItemKey(draft.items.map((entry) => entry.key)),
        label: null,
        text: after,
        regions: [],
        flags: item.regions.length > 0 ? ["unlocated"] : [],
        selected: item.regions.length > 0 ? false : item.selected,
        fix: null,
    };
    const items = [...draft.items];
    items.splice(index, 1, { ...item, text: before, fix: null }, second);
    return updateItems(draft, items);
}

/** 复制出一题（图片题拆分：复制后分别调整区域） */
export function duplicateItem(draft: BatchDraft, key: string): BatchDraft {
    const index = indexOf(draft, key);
    if (index < 0 || draft.items.length >= MAX_SPLIT_QUESTIONS) return draft;
    const item = draft.items[index];
    const copy: DraftItem = { ...item, key: newItemKey(draft.items.map((entry) => entry.key)), label: null, regions: item.regions.map((region) => ({ ...region })) };
    const items = [...draft.items];
    items.splice(index + 1, 0, copy);
    return updateItems(draft, items);
}

/** 把一段未计入题目的内容加为新题（放在末尾） */
export function restoreIgnored(draft: BatchDraft, index: number): BatchDraft {
    const text = draft.ignored[index];
    if (text === undefined || draft.items.length >= MAX_SPLIT_QUESTIONS) return draft;
    const item: DraftItem = {
        key: newItemKey(draft.items.map((entry) => entry.key)),
        label: null, text, material: null, section: null, selected: true, regions: [], hasFigure: false, flags: [],
    };
    return { ...draft, items: [...draft.items, item], ignored: draft.ignored.filter((_, i) => i !== index) };
}

/** 新增一个空白的图片题（由用户在原图上框选） */
export function addImageItem(draft: BatchDraft, region: DraftRegion): BatchDraft {
    if (draft.items.length >= MAX_SPLIT_QUESTIONS) return draft;
    const item: DraftItem = {
        key: newItemKey(draft.items.map((entry) => entry.key)),
        label: null, text: "", material: null, section: null, selected: true, regions: [region], hasFigure: false, flags: [],
    };
    return { ...draft, items: [...draft.items, item] };
}

/** 一题的修正结果（key 对应草稿中的题，original 为送去修正时的文字） */
export interface TextFixSuggestion extends DraftTextFix {
    key: string;
}

/** 记下修正建议：只用于文字仍与送去修正时一致的题，修正结果与原文相同的视为无需修改 */
export function applyTextFixes(draft: BatchDraft, fixes: TextFixSuggestion[]): BatchDraft {
    const byKey = new Map(fixes.map((fix) => [fix.key, fix]));
    let changed = false;
    const items = draft.items.map((item) => {
        const fix = byKey.get(item.key);
        if (!fix || item.text !== fix.original || fix.text === fix.original) return item;
        changed = true;
        return { ...item, fix: { original: fix.original, text: fix.text, uncertain: fix.uncertain } };
    });
    return changed ? updateItems(draft, items) : draft;
}

/** 有待确认修正建议的题 */
export function pendingTextFixes(draft: BatchDraft): DraftItem[] {
    return draft.items.filter((item) => item.fix && item.fix.original === item.text);
}

/** 采用修正建议；keys 为空时采用全部 */
export function acceptTextFixes(draft: BatchDraft, keys?: string[]): BatchDraft {
    const targets = keys ? new Set(keys) : null;
    let changed = false;
    const items = draft.items.map((item) => {
        if (!item.fix || (targets && !targets.has(item.key))) return item;
        changed = true;
        // 建议生成后文字又被改过时不覆盖，只放弃建议
        return item.fix.original === item.text ? { ...item, text: item.fix.text, fix: null } : { ...item, fix: null };
    });
    return changed ? updateItems(draft, items) : draft;
}

/** 放弃修正建议，保留原文 */
export function rejectTextFix(draft: BatchDraft, key: string): BatchDraft {
    return updateItems(draft, draft.items.map((item) => (item.key === key && item.fix ? { ...item, fix: null } : item)));
}

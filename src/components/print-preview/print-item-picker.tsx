"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { applyPrintSelection, matchesPrintSearch } from "@/lib/print/print-preview";
import type { PrintableErrorItem } from "@/types/api";

/** 题目超过该数量时默认收起列表，避免占满屏幕 */
const COLLAPSE_THRESHOLD = 20;

interface PrintItemPickerProps {
    items: PrintableErrorItem[];
    selectedIds: Set<string>;
    selectedCount: number;
    /** 选中题目在打印稿中的题号（从 1 开始） */
    printNumbers: ReadonlyMap<string, number>;
    onToggle: (id: string) => void;
    onSelectionChange: (next: Set<string>) => void;
}

/** 勾选要打印的题目：可搜索，全选、清空、反选作用于当前搜索结果 */
export function PrintItemPicker({ items, selectedIds, selectedCount, printNumbers, onToggle, onSelectionChange }: PrintItemPickerProps) {
    const { t } = useLanguage();
    const [expanded, setExpanded] = useState(items.length <= COLLAPSE_THRESHOLD);
    const [query, setQuery] = useState("");
    const filtered = useMemo(() => items.filter((item) => matchesPrintSearch(item, query)), [items, query]);
    const searching = query.trim().length > 0;
    const apply = (action: "select" | "clear" | "invert") =>
        onSelectionChange(applyPrintSelection(selectedIds, filtered.map((item) => item.id), action));

    return (
        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                    type="button"
                    className="flex items-center gap-1 text-sm font-medium hover:text-primary"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((value) => !value)}
                >
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {t.printPreview.selectItems} ({selectedCount}/{items.length})
                </button>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => apply("select")}>
                        {searching ? t.printPreview.selectFiltered : t.printPreview.selectAll}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => apply("clear")}>
                        {searching ? t.printPreview.clearFiltered : t.printPreview.clearSelection}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => apply("invert")}>
                        {t.printPreview.invertSelection}
                    </Button>
                </div>
            </div>
            {expanded && (
                <>
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t.printPreview.searchPlaceholder}
                            aria-label={t.printPreview.searchPlaceholder}
                            className="h-8 pl-8 text-sm"
                        />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-[40vh] overflow-y-auto pr-1">
                        {filtered.map((item) => {
                            const printNumber = printNumbers.get(item.id);
                            return (
                                <label
                                    key={item.id}
                                    className="flex items-start gap-2 rounded border bg-background p-2 text-xs cursor-pointer hover:border-primary/50"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(item.id)}
                                        onChange={() => onToggle(item.id)}
                                        className="mt-0.5 rounded border-gray-300 text-primary focus:ring-primary"
                                    />
                                    <span className="line-clamp-2">
                                        {/* 题号与打印稿一致；未选中的题目不编号 */}
                                        {printNumber !== undefined && (
                                            <span className="font-semibold">
                                                {t.printPreview.questionNumber.replace('{num}', String(printNumber))}
                                                {t.common.colon}
                                            </span>
                                        )}
                                        {item.shortId && <span className="font-mono text-muted-foreground">{item.shortId} </span>}
                                        {item.questionText}
                                    </span>
                                </label>
                            );
                        })}
                        {filtered.length === 0 && (
                            <p className="col-span-full py-2 text-center text-xs text-muted-foreground">{t.printPreview.noSearchResult}</p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

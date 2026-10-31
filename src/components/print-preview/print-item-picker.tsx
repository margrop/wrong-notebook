"use client";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { PrintableErrorItem } from "@/types/api";

interface PrintItemPickerProps {
    items: PrintableErrorItem[];
    selectedIds: Set<string>;
    selectedCount: number;
    onToggle: (id: string) => void;
    onSelectAll: () => void;
    onClear: () => void;
}

/** 勾选要打印的题目，可全选或清空 */
export function PrintItemPicker({ items, selectedIds, selectedCount, onToggle, onSelectAll, onClear }: PrintItemPickerProps) {
    const { t } = useLanguage();
    return (
        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">
                    {t.printPreview?.selectItems || 'Select Items'} ({selectedCount}/{items.length})
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={onSelectAll}>
                        {t.printPreview?.selectAll || 'Select All'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={onClear}>
                        {t.printPreview?.clearSelection || 'Clear Selection'}
                    </Button>
                </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-44 overflow-y-auto pr-1">
                {items.map((item, index) => (
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
                            <span className="font-semibold">
                                {t.printPreview?.questionNumber?.replace('{num}', String(index + 1)) || `Question ${index + 1}`}
                            </span>
                            {item.questionText ? `${t.common.colon}${item.questionText}` : ''}
                        </span>
                    </label>
                ))}
            </div>
        </div>
    );
}

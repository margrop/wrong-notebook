"use client";

import { useRef } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Crop, FilePlus2, Loader2, Merge, Scissors, Sparkles, Trash2 } from "lucide-react";
import { RegionThumbnail } from "@/components/import-batch/region-thumbnail";
import { TextFixPanel } from "@/components/import-batch/text-fix-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ImportBatchSource } from "@/lib/import/import-batch-types";
import { isItemReady } from "@/lib/question-split/draft";
import type { BatchDraft, DraftItem } from "@/lib/question-split/draft";
import { acceptTextFixes, duplicateItem, mergeWithPrevious, moveItem, rejectTextFix, removeItem, setSelected, splitItemAt, updateItem } from "@/lib/question-split/draft-ops";
import { cn } from "@/lib/utils";

interface DraftItemCardProps {
    item: DraftItem;
    index: number;
    total: number;
    source: ImportBatchSource;
    expanded: boolean;
    onToggleExpand: () => void;
    onEdit: (change: (draft: BatchDraft) => BatchDraft, group?: string) => void;
    /** 图片批次：整页图与尺寸，用于显示裁片 */
    image?: { url: string; width: number; height: number } | null;
    onAdjustRegion?: () => void;
    /** 高亮（在原图上点了这一题） */
    highlighted?: boolean;
    /** 文字批次：用 AI 修正这一题的文字 */
    onFixText?: () => void;
    /** 这一题正在修正；fixBusy 为有任何修正在进行 */
    fixing?: boolean;
    fixBusy?: boolean;
    /** 照片批次：这道题接到下一页（为空时不显示）；continuing 为正在处理 */
    onContinue?: () => void;
    continuing?: boolean;
}

/** 分题预览中的一道题：默认折叠显示开头几行，展开后可编辑、拆分、合并、移动、删除 */
export function DraftItemCard({ item, index, total, source, expanded, onToggleExpand, onEdit, image, onAdjustRegion, highlighted, onFixText, fixing, fixBusy, onContinue, continuing }: DraftItemCardProps) {
    const { t } = useLanguage();
    const textRef = useRef<HTMLTextAreaElement>(null);
    const ready = isItemReady(item, source);
    const id = `draft-item-${item.key}`;
    // 建议生成后文字又被改过时不再显示（接受时也不会覆盖）
    const pendingFix = item.fix && item.fix.original === item.text ? item.fix : null;

    const splitAtCursor = () => {
        const offset = textRef.current?.selectionStart ?? 0;
        onEdit((draft) => splitItemAt(draft, item.key, offset));
    };

    return (
        <li
            id={id}
            className={cn("rounded-xl border bg-card p-3 transition-colors", !item.selected && "opacity-70", highlighted && "border-primary ring-2 ring-primary/30")}
            data-testid="draft-item"
            data-selected={item.selected}
            data-fix-pending={pendingFix ? "true" : undefined}
        >
            <div className="flex items-start gap-3">
                <Checkbox
                    className="mt-1 h-5 w-5"
                    checked={item.selected}
                    disabled={!ready}
                    onCheckedChange={(checked) => onEdit((draft) => setSelected(draft, item.key, checked === true))}
                    aria-label={t.importBatch.question.replace("{index}", String(index + 1))}
                />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={onToggleExpand} aria-expanded={expanded} aria-controls={`${id}-body`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold">{t.importBatch.question.replace("{index}", String(index + 1))}</span>
                        {item.label && <span className="text-xs text-muted-foreground">{t.importBatch.originalLabel.replace("{label}", item.label)}</span>}
                        {item.material && <Badge variant="secondary">{t.importBatch.material}</Badge>}
                        {item.hasFigure && <Badge variant="outline">{t.importBatch.hasFigure}</Badge>}
                        {pendingFix && <Badge className="bg-violet-600 text-white hover:bg-violet-600">{t.importBatch.fixText.pending}</Badge>}
                        {item.section && <span className="truncate text-xs text-muted-foreground">{item.section.split("\n")[0]}</span>}
                    </div>
                    {!expanded && !pendingFix && item.text && (
                        <p className="mt-1 line-clamp-3 whitespace-pre-line break-words text-sm text-muted-foreground">{item.text}</p>
                    )}
                    {item.flags.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                            {item.flags.map((flag) => (
                                <li key={flag} className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    {t.importBatch.flags[flag]}
                                </li>
                            ))}
                        </ul>
                    )}
                </button>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={onToggleExpand} aria-label={expanded ? t.importBatch.collapse : t.importBatch.edit}>
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
            </div>

            {image && item.regions.length > 0 && (
                <button type="button" className="mt-2 block w-full max-w-md pl-8" onClick={onAdjustRegion} aria-label={t.importBatch.adjustRegion}>
                    <RegionThumbnail imageUrl={image.url} imageSize={image} regions={item.regions} className="max-h-48" />
                </button>
            )}

            {onContinue && (
                <div className="mt-2 pl-8">
                    <Button type="button" size="sm" variant="outline" onClick={onContinue} disabled={continuing} data-testid="draft-continue">
                        {continuing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-1 h-4 w-4" />}
                        {continuing ? t.importBatch.continuation.working : t.importBatch.continuation.button}
                    </Button>
                </div>
            )}

            {pendingFix && (
                <div className="mt-2 pl-8">
                    <TextFixPanel
                        fix={pendingFix}
                        onAccept={() => onEdit((draft) => acceptTextFixes(draft, [item.key]))}
                        onReject={() => onEdit((draft) => rejectTextFix(draft, item.key))}
                    />
                </div>
            )}

            {expanded && (
                <div id={`${id}-body`} className="mt-3 space-y-3 pl-8">
                    {item.material && (
                        <div className="rounded-lg bg-muted/60 p-2 text-sm">
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-xs font-medium">{t.importBatch.material} · {t.importBatch.materialHint}</span>
                                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onEdit((draft) => updateItem(draft, item.key, { material: null }))}>
                                    {t.importBatch.removeMaterial}
                                </Button>
                            </div>
                            <p className="line-clamp-6 whitespace-pre-line break-words text-muted-foreground">{item.material}</p>
                        </div>
                    )}
                    {source === "text" ? (
                        <>
                            <Textarea
                                ref={textRef}
                                aria-label={t.importBatch.questionText}
                                value={item.text}
                                onChange={(event) => onEdit((draft) => updateItem(draft, item.key, { text: event.target.value }), `text-${item.key}`)}
                                className="min-h-28 font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">{t.importBatch.splitHint}</p>
                        </>
                    ) : (
                        <>
                            {item.text && <p className="whitespace-pre-line break-words text-sm text-muted-foreground">{item.text}</p>}
                            <p className="text-xs text-muted-foreground">{t.importBatch.imageTextHint}</p>
                        </>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {source === "text" ? (
                            <>
                                <Button type="button" size="sm" variant="outline" onClick={splitAtCursor}>
                                    <Scissors className="mr-1 h-4 w-4" />{t.importBatch.splitHere}
                                </Button>
                                {onFixText && (
                                    <Button type="button" size="sm" variant="outline" onClick={onFixText} disabled={fixBusy || !item.text.trim()}>
                                        {fixing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                                        {fixing ? t.importBatch.fixText.running : t.importBatch.fixText.one}
                                    </Button>
                                )}
                            </>
                        ) : (
                            <>
                                <Button type="button" size="sm" variant="outline" onClick={onAdjustRegion}>
                                    <Crop className="mr-1 h-4 w-4" />{item.regions.length ? t.importBatch.adjustRegion : t.importBatch.locate}
                                </Button>
                                <Button type="button" size="sm" variant="outline" onClick={() => onEdit((draft) => duplicateItem(draft, item.key))}>
                                    <Copy className="mr-1 h-4 w-4" />{t.importBatch.duplicate}
                                </Button>
                            </>
                        )}
                        <Button type="button" size="sm" variant="outline" disabled={index === 0} onClick={() => onEdit((draft) => mergeWithPrevious(draft, item.key))}>
                            <Merge className="mr-1 h-4 w-4" />{t.importBatch.mergeUp}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => onEdit((draft) => moveItem(draft, item.key, -1))} aria-label={t.importBatch.moveUp}>
                            <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={index === total - 1} onClick={() => onEdit((draft) => moveItem(draft, item.key, 1))} aria-label={t.importBatch.moveDown}>
                            <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => onEdit((draft) => removeItem(draft, item.key))}>
                            <Trash2 className="mr-1 h-4 w-4" />{t.importBatch.delete}
                        </Button>
                    </div>
                </div>
            )}
        </li>
    );
}

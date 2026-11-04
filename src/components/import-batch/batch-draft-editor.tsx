"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Plus, Undo2 } from "lucide-react";
import { ContinuationControls } from "@/components/import-batch/continuation-controls";
import { DraftItemCard } from "@/components/import-batch/draft-item-card";
import { DraftStartBar } from "@/components/import-batch/draft-start-bar";
import { IgnoredContent } from "@/components/import-batch/ignored-content";
import { PageImageOverview } from "@/components/import-batch/page-image-overview";
import { RegionEditorDialog } from "@/components/import-batch/region-editor-dialog";
import { TextFixToolbar } from "@/components/import-batch/text-fix-toolbar";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";
import { isItemReady } from "@/lib/question-split/draft";
import type { BatchDraft, DraftRegion } from "@/lib/question-split/draft";
import { acceptTextFixes, addImageItem, pendingTextFixes, restoreIgnored, setAllSelected, updateItem } from "@/lib/question-split/draft-ops";
import { canContinueOnNextPage, useBatchContinuation } from "@/lib/hooks/use-batch-continuation";
import { useDraftTextFix } from "@/lib/hooks/use-draft-text-fix";
import type { DraftSaveState } from "@/lib/hooks/use-import-batch";

interface BatchDraftEditorProps {
    batch: Pick<ImportBatchDetail, "id" | "source" | "subjectId" | "targetSubjectId" | "paperLevel">;
    draft: BatchDraft;
    onEdit: (change: (draft: BatchDraft) => BatchDraft, group?: string) => void;
    onUndo: () => void;
    canUndo: boolean;
    saveState: DraftSaveState;
    /** 图片批次的整页图（含像素尺寸）；文字批次为空 */
    image: { url: string; width: number; height: number } | null;
    confirmBeforeImport: boolean;
    starting: string | null;
    onStart: () => void;
    onDiscard: () => void;
    /** 保存冲突后保留的本页修改：可恢复或放弃 */
    hasConflictCopy?: boolean;
    onRestoreConflict?: () => void;
    onDismissConflict?: () => void;
}

/** 分题预览：摘要、整页原图（图片批次）、题目列表、未计入题目的内容与底部操作栏 */
export function BatchDraftEditor({ batch, draft, onEdit, onUndo, canUndo, saveState, image, confirmBeforeImport, starting, onStart, onDiscard, hasConflictCopy, onRestoreConflict, onDismissConflict }: BatchDraftEditorProps) {
    const { t } = useLanguage();
    const source = batch.source;
    // 一次只展开一道题，手机上不会铺满长表单
    const [expanded, setExpanded] = useState<string | null>(null);
    const [highlighted, setHighlighted] = useState<string | null>(null);
    const [regionTarget, setRegionTarget] = useState<{ key: string | null; regions: DraftRegion[] } | null>(null);

    const ready = draft.items.filter((item) => item.selected && isItemReady(item, source));
    const allSelected = draft.items.length > 0 && draft.items.every((item) => item.selected || !isItemReady(item, source));
    const selectedWithoutRegion = draft.items.filter((item) => item.selected && !isItemReady(item, source)).length;
    const textFix = useDraftTextFix(batch.id, draft, onEdit);
    const continuation = useBatchContinuation(batch, image?.url ?? null, draft, onEdit);
    const pendingFixes = source === "text" ? pendingTextFixes(draft).length : 0;
    // 批量修正：已选、有文字、还没有待确认建议的题
    const fixTargets = source === "text" ? ready.filter((item) => !(item.fix && item.fix.original === item.text)).map((item) => item.key) : [];

    const focusItem = (key: string) => {
        setHighlighted(key);
        setExpanded(key);
        document.getElementById(`draft-item-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    return (
        <div className="space-y-4 pb-36 md:pb-24">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-semibold" data-testid="draft-summary">
                    {t.importBatch.detected.replace("{count}", String(draft.items.length))}
                    <span className="mx-2 text-muted-foreground">·</span>
                    {t.importBatch.selected.replace("{count}", String(ready.length))}
                </p>
                <div className="flex items-center gap-1">
                    <span className="mr-2 flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite" data-testid="draft-save-state" data-state={saveState}>
                        {saveState === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
                        {t.importBatch.save[saveState]}
                    </span>
                    <Button type="button" size="sm" variant="ghost" disabled={!canUndo} onClick={onUndo}>
                        <Undo2 className="mr-1 h-4 w-4" />{t.importBatch.undo}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onEdit((current) => setAllSelected(current, !allSelected, (item) => isItemReady(item, source)))}>
                        {allSelected ? t.importBatch.selectNone : t.importBatch.selectAll}
                    </Button>
                </div>
            </div>

            {hasConflictCopy && (
                <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm" role="status" data-testid="draft-conflict">
                    <p>{t.importBatch.conflictKept}</p>
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={onRestoreConflict}>{t.importBatch.restoreMine}</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={onDismissConflict}>{t.importBatch.discardMine}</Button>
                    </div>
                </div>
            )}

            {source === "text" && draft.items.length > 0 && (
                <TextFixToolbar
                    targetCount={fixTargets.length}
                    pendingCount={pendingFixes}
                    fixing={textFix.fixing}
                    onFix={() => void textFix.fix(fixTargets)}
                    onAcceptAll={() => onEdit((current) => acceptTextFixes(current))}
                />
            )}

            {draft.warnings.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    {draft.warnings.map((warning) => (
                        <li key={warning} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.importBatch.warnings[warning]}</li>
                    ))}
                </ul>
            )}

            <ContinuationControls inputProps={continuation.inputProps} created={continuation.created} />

            {image && (
                <PageImageOverview imageUrl={image.url} items={draft.items} onSelectItem={focusItem} highlightedKey={highlighted} />
            )}

            {draft.items.length === 0 ? (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t.importBatch.emptyDraft}</p>
            ) : (
                <ol className="space-y-3">
                    {draft.items.map((item, index) => (
                        <DraftItemCard
                            key={item.key}
                            item={item}
                            index={index}
                            total={draft.items.length}
                            source={source}
                            expanded={expanded === item.key}
                            onToggleExpand={() => setExpanded((current) => (current === item.key ? null : item.key))}
                            onEdit={onEdit}
                            image={image}
                            onAdjustRegion={() => setRegionTarget({ key: item.key, regions: item.regions })}
                            highlighted={highlighted === item.key}
                            onFixText={source === "text" ? () => void textFix.fix([item.key]) : undefined}
                            fixing={textFix.fixingKeys.includes(item.key)}
                            fixBusy={textFix.fixing}
                            onContinue={image && canContinueOnNextPage(item, index, draft.items.length) ? () => continuation.pick(item.key) : undefined}
                            continuing={continuation.busyKey === item.key}
                        />
                    ))}
                </ol>
            )}

            {image && (
                <Button type="button" variant="outline" size="sm" onClick={() => setRegionTarget({ key: null, regions: [] })}>
                    <Plus className="mr-1 h-4 w-4" />{t.importBatch.addQuestion}
                </Button>
            )}

            <IgnoredContent ignored={draft.ignored} onRestore={(index) => onEdit((current) => restoreIgnored(current, index))} />

            <DraftStartBar
                count={ready.length}
                missingRegions={selectedWithoutRegion}
                pendingFixes={pendingFixes}
                confirmBeforeImport={confirmBeforeImport}
                starting={starting}
                onStart={onStart}
                onDiscard={onDiscard}
            />

            {image && regionTarget && (
                <RegionEditorDialog
                    open
                    imageUrl={image.url}
                    regions={regionTarget.regions}
                    onClose={() => setRegionTarget(null)}
                    onSave={(regions) => {
                        const key = regionTarget.key;
                        onEdit((current) => (key ? updateItem(current, key, { regions, selected: true }) : addImageItem(current, regions[0])));
                        setRegionTarget(null);
                    }}
                />
            )}
        </div>
    );
}

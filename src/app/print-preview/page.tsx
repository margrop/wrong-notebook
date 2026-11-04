"use client";

import { useEffect, useState, Suspense, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { PrintItemPicker } from "@/components/print-preview/print-item-picker";
import { PrintOptions, type PrintDisplayOptions } from "@/components/print-preview/print-options";
import { PrintableQuestion } from "@/components/print-preview/printable-question";
import { apiClient } from "@/lib/api-client";
import type { PaginatedResponse, PrintableErrorItem } from "@/types/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { useSavedAnswerSpaces } from "@/lib/hooks/use-saved-answer-spaces";
import type { AnswerSpaceChange } from "@/lib/hooks/use-saved-answer-spaces";
import { PRINT_PREVIEW_PAGE_SIZE } from "@/lib/constants/pagination";
import { frontendLogger } from "@/lib/frontend-logger";
import { loadAllImages } from "@/lib/print/print-images";
import { DEFAULT_PRINT_OPTIONS, readStoredPrintOptions, writeStoredPrintOptions } from "@/lib/print/print-preview-options";
import { usePaperGroups } from "@/lib/hooks/use-paper-groups";
import {
    chunk,
    fetchAllPages,
    getPrintPreviewCountLabel,
    getPrintPreviewEmptyState,
    getSelectedPrintItems,
    shouldReserveAnswerSpace,
} from "@/lib/print/print-preview";

/** 保存错题打印时手动调整的单题留白；接口单次最多接收一页题目，超出时分批保存 */
async function saveAnswerSpaces(changes: AnswerSpaceChange[]): Promise<void> {
    for (const batch of chunk(changes, PRINT_PREVIEW_PAGE_SIZE)) {
        await apiClient.put("/api/error-items/answer-space", { items: batch });
    }
}

function PrintPreviewContent() {
    const searchParams = useSearchParams();
    const { t } = useLanguage();
    const [items, setItems] = useState<PrintableErrorItem[]>([]);
    usePageTitle(t.printPreview.title);
    const [loading, setLoading] = useState(true);
    const [options, setOptions] = useState<PrintDisplayOptions>(DEFAULT_PRINT_OPTIONS);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 本地存储只能在客户端挂载后读取，避免与服务端渲染结果不一致
        setOptions(readStoredPrintOptions());
    }, []);
    /** 修改显示选项并记在本机浏览器，下次打开沿用 */
    const updateOptions = (patch: Partial<PrintDisplayOptions>) => setOptions((prev) => {
        const next = { ...prev, ...patch };
        writeStoredPrintOptions(next);
        return next;
    });
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const {
        customSpaces,
        setSpace: setQuestionCustomSpace,
        resetAll: resetAllCustomSpaces,
        saveFailed: answerSpaceSaveFailed,
    } = useSavedAnswerSpaces(items, saveAnswerSpaces);

    const fetchItems = useCallback(async () => {
        try {
            // 打印预览需要所有符合条件的题目，逐页读取，不在单页上限处截断
            const allItems = await fetchAllPages((page) => {
                const params = new URLSearchParams(searchParams.toString());
                params.set("page", String(page));
                params.set("pageSize", String(PRINT_PREVIEW_PAGE_SIZE));
                params.set("view", "print");
                return apiClient.get<PaginatedResponse<PrintableErrorItem>>(`/api/error-items/list?${params.toString()}`);
            });
            setItems(allItems);
            setSelectedIds(new Set(allItems.map((item) => item.id)));
        } catch (error) {
            frontendLogger.error('[PrintPreview]', 'Failed to fetch items', { error });
        } finally {
            setLoading(false);
        }
    }, [searchParams]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或条件变化时加载，请求前后更新加载状态和结果
        fetchItems();
    }, [fetchItems]);
    const contentRef = useRef<HTMLDivElement>(null);
    /** 打印前加载图片的进度；为 null 表示未在准备打印 */
    const [imageProgress, setImageProgress] = useState<{ loaded: number; total: number } | null>(null);
    const handlePrint = async () => {
        if (contentRef.current) {
            // 原图懒加载，打印前先全部加载，避免打印出空白
            await loadAllImages(contentRef.current, { onProgress: (loaded, total) => setImageProgress({ loaded, total }) });
        }
        setImageProgress(null);
        window.print();
    };

    const { groups: paperGroups } = usePaperGroups();
    const paperGroupNames = useMemo(() => new Map(paperGroups.map((group) => [group.id, group.name])), [paperGroups]);
    const selectedItems = useMemo(() => getSelectedPrintItems(items, selectedIds), [items, selectedIds]);
    const printNumbers = useMemo(() => new Map(selectedItems.map((item, index) => [item.id, index + 1])), [selectedItems]);
    const reserveAnswerSpace = shouldReserveAnswerSpace(options.showAnswers, options.showAnalysis);
    const countLabel = getPrintPreviewCountLabel(items.length, selectedItems.length);
    const emptyState = getPrintPreviewEmptyState(items.length, selectedItems.length);

    const toggleSelectedItem = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const removeFromPrint = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">{t.common.loading}</p>
            </div>
        );
    }

    return (
        <>
            {/* 标题、打印按钮与显示选项常驻顶部（打印时隐藏）；选题列表随页面滚动，避免题目多时占满屏幕 */}
            <div className="print:hidden sticky top-0 z-10 bg-background border-b p-3 sm:p-4 shadow-sm">
                <div className="max-w-6xl mx-auto space-y-3">
                    <div className="flex items-center gap-3">
                        <BackButton fallbackUrl="/notebooks" />
                        <h1 className="text-lg sm:text-xl font-bold flex-1">
                            {t.printPreview?.title || 'Print Preview'} ({countLabel} {t.notebooks?.items || 'items'})
                        </h1>
                        <Button onClick={handlePrint} size="sm" className="whitespace-nowrap" disabled={selectedItems.length === 0 || imageProgress !== null}>
                            {imageProgress
                                ? t.printPreview.loadingImages.replace('{loaded}', String(imageProgress.loaded)).replace('{total}', String(imageProgress.total))
                                : (t.printPreview?.printButton || 'Print / Save PDF')}
                        </Button>
                    </div>
                    <PrintOptions
                        options={options}
                        onChange={updateOptions}
                        hasCustomSpaces={Object.keys(customSpaces).length > 0}
                        onResetCustomSpaces={resetAllCustomSpaces}
                    />
                    {answerSpaceSaveFailed && (
                        <p className="text-xs text-destructive">{t.exam.answerSpaceSaveFailed}</p>
                    )}
                </div>
            </div>
            <div className="print:hidden border-b p-3 sm:p-4">
                <div className="max-w-6xl mx-auto">
                    <PrintItemPicker
                        items={items}
                        selectedIds={selectedIds}
                        selectedCount={selectedItems.length}
                        printNumbers={printNumbers}
                        onToggle={toggleSelectedItem}
                        onSelectionChange={setSelectedIds}
                    />
                </div>
            </div>

            {/* Print Content */}
            <div ref={contentRef} className="max-w-4xl mx-auto p-8 print:p-0">
                {selectedItems.map((item, index) => (
                    <PrintableQuestion
                        key={item.id}
                        item={item}
                        index={index}
                        options={options}
                        reserveAnswerSpace={reserveAnswerSpace}
                        customAnswerSpacePx={customSpaces[item.id]}
                        onCustomAnswerSpaceChange={setQuestionCustomSpace}
                        paperGroupName={item.paperLevel ? paperGroupNames.get(item.paperLevel) ?? item.paperLevel : null}
                        onRemove={removeFromPrint}
                    />
                ))}

                {emptyState && (
                    <div className="text-center py-12 text-muted-foreground">
                        {emptyState === 'noSelection'
                            ? (t.printPreview?.noSelection || 'No items selected')
                            : (t.printPreview?.noItems || 'No matching error items')}
                    </div>
                )}
            </div>
        </>
    );
}

export default function PrintPreviewPage() {
    const { t } = useLanguage();
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">{t.common.loading}</div>}>
            <PrintPreviewContent />
        </Suspense>
    );
}

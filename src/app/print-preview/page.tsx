"use client";

import { useEffect, useState, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";
import { PrintItemPicker } from "@/components/print-preview/print-item-picker";
import { PrintOptions, type PrintDisplayOptions } from "@/components/print-preview/print-options";
import { PrintableQuestion } from "@/components/print-preview/printable-question";
import { apiClient } from "@/lib/api-client";
import type { PaginatedResponse, PrintableErrorItem } from "@/types/api";
import { useLanguage } from "@/contexts/LanguageContext";
import {
    createDocxArchive,
    rasterizeImageForDocx,
    rasterizeSvgFigureForDocx,
    triggerDocxDownload,
} from "@/lib/docx-export";
import { resolveQuestionAnswerSpacePx } from "@/lib/exam-answer-space";
import { usePageTitle } from "@/lib/page-title";
import { PRINT_PREVIEW_PAGE_SIZE } from "@/lib/constants/pagination";
import { frontendLogger } from "@/lib/frontend-logger";
import {
    getPrintableItemTagNames,
    getPrintPreviewCountLabel,
    getPrintPreviewEmptyState,
    getSelectedPrintItems,
    shouldReserveAnswerSpace,
} from "@/lib/print-preview";
import { usePaperGroups } from "@/lib/use-paper-groups";

function PrintPreviewContent() {
    const searchParams = useSearchParams();
    const { t } = useLanguage();
    const [items, setItems] = useState<PrintableErrorItem[]>([]);
    usePageTitle(t.printPreview.title);
    const [loading, setLoading] = useState(true);
    const [options, setOptions] = useState<PrintDisplayOptions>({
        showQuestionText: false,
        showAnswers: false,
        showAnalysis: false,
        showTags: false,
        imageScale: 70,
        answerSpace: "auto",
    });
    const updateOptions = (patch: Partial<PrintDisplayOptions>) => setOptions((prev) => ({ ...prev, ...patch }));
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [customSpaces, setCustomSpaces] = useState<Record<string, number>>({});
    const [exportingDocx, setExportingDocx] = useState(false);
    const { groups: paperGroups } = usePaperGroups();

    const setQuestionCustomSpace = (id: string, px: number | null) => {
        setCustomSpaces((prev) => {
            if (px === null) {
                const next = { ...prev };
                delete next[id];
                return next;
            }
            return { ...prev, [id]: px };
        });
    };

    const fetchItems = useCallback(async () => {
        try {
            const params = new URLSearchParams(searchParams.toString());
            // 打印预览需要所有符合条件的数据，设置较大的 pageSize
            params.set("pageSize", String(PRINT_PREVIEW_PAGE_SIZE));
            params.set("view", "print");
            const response = await apiClient.get<PaginatedResponse<PrintableErrorItem>>(`/api/error-items/list?${params.toString()}`);
            setItems(response.items);
            setSelectedIds(new Set(response.items.map((item) => item.id)));
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
    const handlePrint = () => {
        window.print();
    };

    const selectedItems = getSelectedPrintItems(items, selectedIds);
    const reserveAnswerSpace = shouldReserveAnswerSpace(options.showAnswers, options.showAnalysis);
    const countLabel = getPrintPreviewCountLabel(items.length, selectedItems.length);
    const emptyState = getPrintPreviewEmptyState(items.length, selectedItems.length);

    const handleExportDocx = async () => {
        if (exportingDocx || selectedItems.length === 0) return;
        setExportingDocx(true);
        try {
            const questionBlocks = await Promise.all(
                selectedItems.map(async (item, index) => {
                    const tags = getPrintableItemTagNames(item);
                    const paperGroupName = item.paperLevel
                        ? paperGroups.find((g) => g.id === item.paperLevel)?.name || item.paperLevel
                        : null;
                    const metaParts = [
                        item.shortId ? t.printPreview.source.replace("{id}", item.shortId) : null,
                        item.subject?.name ?? null,
                        item.gradeSemester ?? null,
                        paperGroupName ? `${t.printPreview.paperLevel}: ${paperGroupName}` : null,
                        options.showTags && tags.length > 0 ? `${t.printPreview.knowledgePoints}: ${tags.join("、")}` : null,
                    ].filter((part): part is string => Boolean(part));

                    const useTextMode = Boolean(options.showQuestionText && item.questionText);
                    const image = useTextMode
                        ? await rasterizeSvgFigureForDocx(item.figureSvg, item.figureScale, item.figureAlign)
                        : (item.originalImageUrl
                            ? await rasterizeImageForDocx(item.originalImageUrl, {
                                scalePercent: options.imageScale,
                                maxBaseWidthPx: 560,
                                align: "left",
                            })
                            : null);

                    return {
                        heading: t.printPreview.questionNumber.replace("{num}", String(index + 1)),
                        meta: metaParts.join(" · "),
                        questionText: useTextMode ? (item.questionText ?? "") : undefined,
                        image,
                        inlineAnswerLabel: options.showAnswers && item.answerText ? t.printPreview.referenceAnswer : undefined,
                        inlineAnswerText: options.showAnswers && item.answerText ? item.answerText : undefined,
                        inlineAnalysisLabel: options.showAnalysis && item.analysis ? t.printPreview.analysis : undefined,
                        inlineAnalysisText: options.showAnalysis && item.analysis ? item.analysis : undefined,
                        answerSpacePx: reserveAnswerSpace
                            ? resolveQuestionAnswerSpacePx(
                                options.answerSpace ?? "auto",
                                item.questionText || "",
                                customSpaces[item.id],
                            )
                            : 0,
                    };
                }),
            );
            const bytes = createDocxArchive({
                title: t.printPreview.title,
                questions: questionBlocks,
            });
            triggerDocxDownload(bytes, t.printPreview.title);
        } finally {
            setExportingDocx(false);
        }
    };

    const toggleSelectedItem = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const selectAllItems = () => {
        setSelectedIds(new Set(items.map((item) => item.id)));
    };

    const clearSelectedItems = () => {
        setSelectedIds(new Set());
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">{t.common.loading}</p>
            </div>
        );
    }

    return (
        <>
            {/* Print Controls - Hidden when printing */}
            <div className="print:hidden sticky top-0 z-10 bg-background border-b p-3 sm:p-4 shadow-sm">
                <div className="max-w-6xl mx-auto space-y-3">
                    {/* Header Row */}
                    <div className="flex items-center gap-3">
                        <BackButton fallbackUrl="/notebooks" />
                        <h1 className="text-lg sm:text-xl font-bold flex-1">
                            {t.printPreview?.title || 'Print Preview'} ({countLabel} {t.notebooks?.items || 'items'})
                        </h1>
                        <Button
                            variant="outline"
                            size="sm"
                            className="whitespace-nowrap"
                            onClick={handleExportDocx}
                            disabled={selectedItems.length === 0 || exportingDocx}
                        >
                            <Download className="mr-1.5 h-4 w-4" />
                            {exportingDocx ? t.printPreview.exportingDocx : t.printPreview.downloadDocx}
                        </Button>
                        <Button onClick={handlePrint} size="sm" className="whitespace-nowrap" disabled={selectedItems.length === 0}>
                            {t.printPreview?.printButton || 'Print / Save PDF'}
                        </Button>
                    </div>

                    <PrintOptions
                        options={options}
                        onChange={updateOptions}
                        hasCustomSpaces={Object.keys(customSpaces).length > 0}
                        onResetCustomSpaces={() => setCustomSpaces({})}
                    />
                    <PrintItemPicker
                        items={items}
                        selectedIds={selectedIds}
                        selectedCount={selectedItems.length}
                        onToggle={toggleSelectedItem}
                        onSelectAll={selectAllItems}
                        onClear={clearSelectedItems}
                    />
                </div>
            </div>

            {/* Print Content */}
            <div className="max-w-4xl mx-auto p-8 print:p-0">
                {selectedItems.map((item, index) => (
                    <PrintableQuestion
                        key={item.id}
                        item={item}
                        index={index}
                        options={options}
                        reserveAnswerSpace={reserveAnswerSpace}
                        customAnswerSpacePx={customSpaces[item.id]}
                        onCustomAnswerSpaceChange={(px) => setQuestionCustomSpace(item.id, px)}
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

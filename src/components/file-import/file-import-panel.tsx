"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { FileImportBusy, FileImportImageProcessing } from "@/components/file-import/file-import-progress";
import { FileImportPickView } from "@/components/file-import/file-import-pick-view";
import { FileImportSummaryView } from "@/components/file-import/file-import-summary-view";
import { ScannedPdfView } from "@/components/file-import/scanned-pdf-view";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ImportFileTypeDef } from "@/lib/import/file-read";
import { useFileImport } from "@/lib/hooks/use-file-import";
import type { FileImportPhase } from "@/lib/hooks/use-file-import";

export interface FileImportPanelProps {
    /** 默认选中的错题本（首页 ?notebook= 参数） */
    defaultNotebookId?: string;
}

/**
 * 「导入题库文件」面板：选择文件 → 解析 → 摘要（题数/错误/警告/未导入字段）
 * → 选择目标错题本 → 创建批次并跳转导入中心（单批直达详情页）。
 */
export function FileImportPanel({ defaultNotebookId }: FileImportPanelProps) {
    const { t, language } = useLanguage();
    const [notebookId, setNotebookId] = useState(defaultNotebookId ?? "");
    const lang = language === "en" ? "en" : "zh";
    const { phase, handleFile, handleConfirm, handleReset, handleScannedPdfConfirm } = useFileImport({
        language: lang,
        notebookId,
        texts: t.fileImport,
    });

    return (
        <Card className="rounded-2xl" data-testid="file-import-panel">
            <CardContent className="space-y-4 p-6">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                    <FileText className="h-5 w-5" />
                    <span className="text-sm font-medium">{t.fileImport.title}</span>
                </div>
                <FileImportPhaseView
                    phase={phase}
                    notebookId={notebookId}
                    onNotebookChange={setNotebookId}
                    onFile={handleFile}
                    onConfirm={handleConfirm}
                    onReset={handleReset}
                    onScannedPdfConfirm={handleScannedPdfConfirm}
                />
            </CardContent>
        </Card>
    );
}

interface FileImportPhaseViewProps {
    phase: FileImportPhase;
    notebookId: string;
    onNotebookChange: (value: string) => void;
    onFile: (file: File, type: ImportFileTypeDef) => Promise<void>;
    onConfirm: () => Promise<void>;
    onReset: () => void;
    onScannedPdfConfirm: (pages: number[]) => Promise<void>;
}

/** 按流程阶段渲染：选择 → 解析中 → 图片处理中 → 摘要 → 创建中 → 扫描版 PDF → 渲染/建批进度 */
function FileImportPhaseView({ phase, notebookId, onNotebookChange, onFile, onConfirm, onReset, onScannedPdfConfirm }: FileImportPhaseViewProps) {
    switch (phase.kind) {
        case "parsing":
            return <FileImportBusy textKey="parsing" fileName={phase.fileName} />;
        case "processingImages":
            return <FileImportImageProcessing fileName={phase.fileName} done={phase.done} total={phase.total} />;
        case "creating":
            return <FileImportBusy textKey="creating" batchCount={phase.batchCount} />;
        case "rendering-pdf":
            return <FileImportBusy textKey="rendering-pdf" rendered={phase.rendered} total={phase.total} />;
        case "creating-pdf-batches":
            return <FileImportBusy textKey="creating-pdf-batches" rendered={phase.created} total={phase.total} />;
        case "scanned-pdf":
            return (
                <ScannedPdfView
                    fileName={phase.fileName}
                    pageCount={phase.pageCount}
                    notebookId={notebookId}
                    onNotebookChange={onNotebookChange}
                    onConfirm={onScannedPdfConfirm}
                    onReset={onReset}
                />
            );
        case "summary":
            return (
                <FileImportSummaryView
                    fileName={phase.fileName}
                    summary={phase.summary}
                    pdfHasGraphics={phase.result.pdfHasGraphics}
                    notebookId={notebookId}
                    onNotebookChange={onNotebookChange}
                    onConfirm={onConfirm}
                    onReset={onReset}
                />
            );
        default:
            return <FileImportPickView onFile={onFile} />;
    }
}

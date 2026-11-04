"use client";

import { Loader2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface FileImportImageProcessingProps {
    fileName: string;
    done: number;
    total: number;
}

/** 图片处理进度（合成与压缩题目图片） */
export function FileImportImageProcessing({ fileName, done, total }: FileImportImageProcessingProps) {
    const { t } = useLanguage();
    return (
        <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
                {t.fileImport.processingImages.replace("{name}", fileName).replace("{done}", String(done)).replace("{total}", String(total))}
            </p>
        </div>
    );
}

interface FileImportBusyProps {
    textKey: "parsing" | "creating" | "rendering-pdf" | "creating-pdf-batches";
    fileName?: string;
    batchCount?: number;
    rendered?: number;
    total?: number;
}

/** 进行中状态（解析 / 创建批次 / PDF 渲染与建批进度） */
export function FileImportBusy({ textKey, fileName, batchCount, rendered, total }: FileImportBusyProps) {
    const { t } = useLanguage();
    let text: string;
    if (textKey === "parsing") {
        text = t.fileImport.parsing.replace("{name}", fileName ?? "");
    } else if (textKey === "creating") {
        text = t.fileImport.creating.replace("{count}", String(batchCount ?? 0));
    } else if (textKey === "rendering-pdf") {
        text = t.fileImport.pdfRendering.replace("{done}", String(rendered ?? 0)).replace("{total}", String(total ?? 0));
    } else {
        text = t.fileImport.pdfCreatingBatches.replace("{done}", String(rendered ?? 0)).replace("{total}", String(total ?? 0));
    }
    return (
        <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{text}</p>
        </div>
    );
}

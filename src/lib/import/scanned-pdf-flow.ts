/**
 * 扫描版 PDF 导入流程：把渲染出的 PDF 页面图片包装成一个 image 批次请求参数，
 * 整份 PDF 只创建一个识别批次（一次分题），由模型在整卷上下文中分题：
 * 跨页的同一道题合并为一道，材料自带的答案页按题号摘出答案。
 *
 * - buildScannedPdfImageParams：RenderedPdfPage[] → CreateImportBatchInput（纯函数，供测试）。
 * - createScannedPdfBatch：创建单个多页批次；失败（如额度不足）时返回失败原因。
 *
 * 「use client」环境使用；批次创建函数可注入以便测试。
 */
import { createImportBatch } from "@/lib/import/import-batch-client";
import type { CreateImportBatchInput } from "@/lib/import/import-batch-client";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";
import type { RenderedPdfPage } from "@/lib/import/file-parsers/pdf/render-pages";

/** 把渲染出的 PDF 页包装成一个多页 image 批次请求参数（整份 PDF 一个识别任务） */
export function buildScannedPdfImageParams(
    pages: RenderedPdfPage[],
    ctx: { language: "zh" | "en"; notebookId: string },
): CreateImportBatchInput {
    const ordered = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
    return {
        source: "image",
        images: ordered.map((page) => ({
            page: page.pageNumber,
            imageBase64: page.dataUrl,
            imageInfo: {
                sourceType: "pdf-page",
                sourceBytes: page.bytes,
                sourceWidth: page.width,
                sourceHeight: page.height,
                outputWidth: page.width,
                outputHeight: page.height,
                outputBytes: page.bytes,
                quality: undefined,
            },
        })),
        imageInfo: {
            sourceType: "pdf-pages",
            sourceBytes: ordered.reduce((total, page) => total + page.bytes, 0),
        },
        language: ctx.language,
        subjectId: ctx.notebookId,
        targetSubjectId: ctx.notebookId,
    };
}

/** 判断批次创建失败是否为额度不足（服务端返回 429） */
export function isQuotaError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "status" in error && error.status === 429;
}

export type CreateScannedPdfBatchResult =
    | { ok: true; batch: ImportBatchDetail }
    | { ok: false; error: unknown };

/**
 * 创建整份 PDF 的单个多页批次。createBatch 可注入（测试用），默认调用 createImportBatch。
 */
export async function createScannedPdfBatch(
    pages: RenderedPdfPage[],
    ctx: { language: "zh" | "en"; notebookId: string },
    options: {
        createBatch?: (input: CreateImportBatchInput) => Promise<ImportBatchDetail>;
    } = {},
): Promise<CreateScannedPdfBatchResult> {
    const create = options.createBatch ?? createImportBatch;
    try {
        return { ok: true, batch: await create(buildScannedPdfImageParams(pages, ctx)) };
    } catch (error) {
        return { ok: false, error };
    }
}

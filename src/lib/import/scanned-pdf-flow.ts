/**
 * 扫描版 PDF 导入流程：把渲染出的 PDF 页面图片包装成与「拍照自动分题」一致的
 * image 批次请求参数，并逐页创建批次。
 *
 * - buildScannedPdfImageParams：RenderedPdfPage → CreateImportBatchInput（纯函数，供测试）。
 * - createScannedPdfBatches：逐页创建 image 批次，单页失败（如额度不足）不中断，
 *   已创建的批次保留；返回每页结果（成功批次 id 或失败原因）。
 *
 * 「use client」环境使用；批次创建函数可注入以便测试。
 */
import { createImportBatch } from "@/lib/import/import-batch-client";
import type { CreateImportBatchInput } from "@/lib/import/import-batch-client";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";
import type { RenderedPdfPage } from "@/lib/import/file-parsers/pdf/render-pages";

/** 把渲染出的 PDF 页包装成 image 批次请求参数（与 buildImageBatchParams 的 source/字段一致） */
export function buildScannedPdfImageParams(
    page: RenderedPdfPage,
    ctx: { language: "zh" | "en"; notebookId: string },
): CreateImportBatchInput {
    return {
        source: "image",
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
        language: ctx.language,
        subjectId: ctx.notebookId,
        targetSubjectId: ctx.notebookId,
    };
}

export interface ScannedPdfPageSuccess {
    pageNumber: number;
    batch: ImportBatchDetail;
}

export interface ScannedPdfPageFailure {
    pageNumber: number;
    error: unknown;
}

export interface CreateScannedPdfBatchesResult {
    successes: ScannedPdfPageSuccess[];
    failures: ScannedPdfPageFailure[];
}

/** 判断批次创建失败是否为额度不足（服务端返回 429） */
export function isQuotaError(error: unknown): boolean {
    return (error as { status?: number })?.status === 429;
}

/**
 * 逐页创建 image 批次。单页失败不中断后续页；返回成功与失败列表。
 * createBatch 可注入（测试用），默认调用 createImportBatch。
 */
export async function createScannedPdfBatches(
    pages: RenderedPdfPage[],
    ctx: { language: "zh" | "en"; notebookId: string },
    options: {
        createBatch?: (input: CreateImportBatchInput) => Promise<ImportBatchDetail>;
        onProgress?: (completed: number, total: number) => void;
    } = {},
): Promise<CreateScannedPdfBatchesResult> {
    const create = options.createBatch ?? createImportBatch;
    const successes: ScannedPdfPageSuccess[] = [];
    const failures: ScannedPdfPageFailure[] = [];
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        try {
            const batch = await create(buildScannedPdfImageParams(page, ctx));
            successes.push({ pageNumber: page.pageNumber, batch });
        } catch (error) {
            failures.push({ pageNumber: page.pageNumber, error });
        }
        options.onProgress?.(i + 1, pages.length);
    }
    return { successes, failures };
}

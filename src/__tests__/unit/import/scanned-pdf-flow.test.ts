/**
 * 扫描版 PDF 导入流程纯函数测试：
 * buildScannedPdfImageParams 构造与拍照自动分题一致的 image 批次参数；
 * createScannedPdfBatches 逐页创建，单页失败（含额度不足 429）不中断、保留已创建批次；
 * isQuotaError 识别 429。
 */
import { describe, expect, it, vi } from "vitest";
import {
    buildScannedPdfImageParams,
    createScannedPdfBatches,
    isQuotaError,
} from "@/lib/import/scanned-pdf-flow";
import type { RenderedPdfPage } from "@/lib/import/file-parsers/pdf/render-pages";
import type { CreateImportBatchInput } from "@/lib/import/import-batch-client";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";

function page(pageNumber: number): RenderedPdfPage {
    return {
        pageNumber,
        dataUrl: `data:image/jpeg;base64,PAGE${pageNumber}`,
        width: 1000,
        height: 1500,
        bytes: 500_000,
    };
}

function batch(id: string): ImportBatchDetail {
    return { id } as unknown as ImportBatchDetail;
}

describe("buildScannedPdfImageParams", () => {
    it("生成 source=image 的批次参数，目标错题本为所选错题本", () => {
        const params = buildScannedPdfImageParams(page(2), { language: "zh", notebookId: "nb-1" });
        expect(params.source).toBe("image");
        expect(params.imageBase64).toBe("data:image/jpeg;base64,PAGE2");
        expect(params.imageInfo?.sourceType).toBe("pdf-page");
        expect(params.imageInfo?.outputWidth).toBe(1000);
        expect(params.imageInfo?.outputHeight).toBe(1500);
        expect(params.language).toBe("zh");
        expect(params.subjectId).toBe("nb-1");
        expect(params.targetSubjectId).toBe("nb-1");
    });
});

describe("isQuotaError", () => {
    it("识别 status=429 为额度不足", () => {
        expect(isQuotaError({ status: 429 })).toBe(true);
        expect(isQuotaError({ status: 500 })).toBe(false);
        expect(isQuotaError(new Error("x"))).toBe(false);
        expect(isQuotaError(null)).toBe(false);
    });
});

describe("createScannedPdfBatches", () => {
    it("每页创建一个 image 批次并回报进度", async () => {
        const createBatch = vi.fn(async (input: CreateImportBatchInput) => batch(input.imageBase64 ?? ""));
        const onProgress = vi.fn();
        const { successes, failures } = await createScannedPdfBatches(
            [page(1), page(2), page(3)],
            { language: "zh", notebookId: "nb-1" },
            { createBatch, onProgress },
        );
        expect(createBatch).toHaveBeenCalledTimes(3);
        expect(successes.map((s) => s.pageNumber)).toEqual([1, 2, 3]);
        expect(failures).toEqual([]);
        expect(onProgress).toHaveBeenCalledTimes(3);
        expect(onProgress).toHaveBeenLastCalledWith(3, 3);
    });

    it("单页失败不中断后续页，已创建的批次保留", async () => {
        const createBatch = vi.fn(async (input: CreateImportBatchInput) => {
            if ((input.imageBase64 ?? "").includes("PAGE2")) throw Object.assign(new Error("quota"), { status: 429 });
            return batch(input.imageBase64 ?? "");
        });
        const { successes, failures } = await createScannedPdfBatches(
            [page(1), page(2), page(3)],
            { language: "zh", notebookId: "nb-1" },
            { createBatch },
        );
        expect(createBatch).toHaveBeenCalledTimes(3);
        expect(successes.map((s) => s.pageNumber)).toEqual([1, 3]);
        expect(failures).toHaveLength(1);
        expect(failures[0].pageNumber).toBe(2);
        expect(isQuotaError(failures[0].error)).toBe(true);
    });

    it("全部失败时返回空成功列表", async () => {
        const createBatch = vi.fn(async () => {
            throw new Error("network");
        });
        const { successes, failures } = await createScannedPdfBatches(
            [page(1), page(2)],
            { language: "zh", notebookId: "nb-1" },
            { createBatch },
        );
        expect(successes).toEqual([]);
        expect(failures).toHaveLength(2);
    });
});

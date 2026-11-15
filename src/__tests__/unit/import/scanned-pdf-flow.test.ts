/**
 * 扫描版 PDF 导入流程纯函数测试：
 * buildScannedPdfImageParams 把整份 PDF 的页图包装成一个多页 image 批次参数（一个识别任务）；
 * createScannedPdfBatch 创建单个批次，失败（含额度不足 429）时返回失败原因；
 * isQuotaError 识别 429。
 */
import { describe, expect, it, vi } from "vitest";
import {
    buildScannedPdfImageParams,
    createScannedPdfBatch,
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
    it("整份 PDF 生成一个 source=image 的多页批次参数，页码升序，目标错题本为所选错题本", () => {
        const params = buildScannedPdfImageParams([page(3), page(1), page(2)], { language: "zh", notebookId: "nb-1" });
        expect(params.source).toBe("image");
        expect(params.imageBase64).toBeUndefined();
        expect(params.images?.map((image) => image.page)).toEqual([1, 2, 3]);
        expect(params.images?.[1].imageBase64).toBe("data:image/jpeg;base64,PAGE2");
        expect(params.images?.[1].imageInfo?.sourceType).toBe("pdf-page");
        expect(params.images?.[1].imageInfo?.outputWidth).toBe(1000);
        expect(params.images?.[1].imageInfo?.outputHeight).toBe(1500);
        expect(params.imageInfo?.sourceType).toBe("pdf-pages");
        expect(params.imageInfo?.sourceBytes).toBe(1_500_000);
        expect(params.language).toBe("zh");
        expect(params.subjectId).toBe("nb-1");
        expect(params.targetSubjectId).toBe("nb-1");
    });

    it("单页 PDF 也走多页参数（只有一个页条目）", () => {
        const params = buildScannedPdfImageParams([page(2)], { language: "en", notebookId: "nb-2" });
        expect(params.images).toHaveLength(1);
        expect(params.images?.[0].page).toBe(2);
        expect(params.language).toBe("en");
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

describe("createScannedPdfBatch", () => {
    it("整份 PDF 只创建一个批次，携带全部页图", async () => {
        const createBatch = vi.fn(async (input: CreateImportBatchInput) => batch(`b-${input.images?.length}`));
        const outcome = await createScannedPdfBatch(
            [page(1), page(2), page(3)],
            { language: "zh", notebookId: "nb-1" },
            { createBatch },
        );
        expect(createBatch).toHaveBeenCalledTimes(1);
        expect(createBatch.mock.calls[0][0].images).toHaveLength(3);
        expect(outcome).toEqual({ ok: true, batch: { id: "b-3" } });
    });

    it("创建失败（额度不足）时返回失败原因，不抛异常", async () => {
        const createBatch = vi.fn(async () => {
            throw Object.assign(new Error("quota"), { status: 429 });
        });
        const outcome = await createScannedPdfBatch(
            [page(1), page(2)],
            { language: "zh", notebookId: "nb-1" },
            { createBatch },
        );
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(isQuotaError(outcome.error)).toBe(true);
    });

    it("网络错误同样按失败返回", async () => {
        const createBatch = vi.fn(async () => {
            throw new Error("network");
        });
        const outcome = await createScannedPdfBatch([page(1)], { language: "zh", notebookId: "nb-1" }, { createBatch });
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(isQuotaError(outcome.error)).toBe(false);
    });
});

import { describe, expect, it } from "vitest";
import { filterImportCenter } from "@/lib/import/import-task-filter";
import type { ImportBatchSummary } from "@/lib/import/import-batch-types";
import type { ImportTaskListResponse, ImportTaskStatus, ImportTaskSummary } from "@/lib/import/import-task-types";

function task(id: string, status: ImportTaskStatus): ImportTaskSummary {
    return {
        id,
        status,
        mode: "review",
        subjectId: null,
        targetSubjectId: null,
        excerpt: null,
        batchId: null,
        batchItemKey: null,
        error: null,
        errorItemId: null,
        errorItemShortId: null,
        errorItemSeqNo: null,
        notebookName: null,
        duplicate: false,
        hasResult: false,
        unread: false,
        attempts: 1,
        timings: {},
        createdAt: "2026-11-01T00:00:00.000Z",
        finishedAt: null,
    };
}

function batch(
    id: string,
    phase: ImportBatchSummary["phase"],
    counts: Partial<ImportBatchSummary["counts"]> = {},
): ImportBatchSummary {
    return {
        id,
        source: "image",
        splitter: "ai",
        status: "started",
        phase,
        mode: "review",
        itemCount: 0,
        selectedCount: 0,
        counts: { total: 0, active: 0, review: 0, saved: 0, duplicate: 0, failed: 0, ...counts },
        excerpt: null,
        error: null,
        unread: false,
        attempts: 1,
        createdAt: "2026-11-01T00:00:00.000Z",
        startedAt: null,
    };
}

const data: ImportTaskListResponse = {
    tasks: [
        task("analyzing", "analyzing"),
        task("saving", "saving"),
        task("review", "review"),
        task("saved", "saved"),
        task("failed", "failed"),
        task("saved-2", "saved"),
    ],
    batches: [
        batch("draft", "draft"),
        batch("attention", "attention", { review: 1, saved: 2, failed: 1 }),
        batch("done", "done", { saved: 3 }),
        batch("splitting", "splitting"),
        batch("split-failed", "failed"),
    ],
    activeCount: 2,
    unreadCount: 0,
};

describe("filterImportCenter", () => {
    it("待校对筛选同时返回待校对任务、待确认分题的草稿和含待校对题的批次", () => {
        const view = filterImportCenter(data, "review");
        expect(view.tasks.map((item) => item.id)).toEqual(["review"]);
        expect(view.batches.map((item) => item.id)).toEqual(["draft", "attention"]);
    });

    it("进行中筛选包含识别、保存中的任务与分题/解析中的批次", () => {
        const view = filterImportCenter(data, "active");
        expect(view.tasks.map((item) => item.id)).toEqual(["analyzing", "saving"]);
        expect(view.batches.map((item) => item.id)).toEqual(["splitting"]);
    });

    it("失败筛选包含失败任务、分题失败和含失败题的批次", () => {
        const view = filterImportCenter(data, "failed");
        expect(view.tasks.map((item) => item.id)).toEqual(["failed"]);
        expect(view.batches.map((item) => item.id)).toEqual(["attention", "split-failed"]);
    });

    it("已保存筛选只返回全部完成的批次和已保存任务", () => {
        const view = filterImportCenter(data, "saved");
        expect(view.tasks.map((item) => item.id)).toEqual(["saved", "saved-2"]);
        expect(view.batches.map((item) => item.id)).toEqual(["done"]);
    });

    it("全部筛选保留原顺序，并给出各筛选的条目数", () => {
        const view = filterImportCenter(data, "all");
        expect(view.tasks).toEqual(data.tasks);
        expect(view.batches).toEqual(data.batches);
        expect(view.counts).toEqual({ all: 11, active: 3, review: 3, saved: 3, failed: 3 });
    });

    it("没有批次时只按任务筛选", () => {
        const view = filterImportCenter({ tasks: [task("a", "review"), task("b", "failed")], activeCount: 0, unreadCount: 0 }, "review");
        expect(view.tasks.map((item) => item.id)).toEqual(["a"]);
        expect(view.batches).toEqual([]);
        expect(view.counts).toEqual({ all: 2, active: 0, review: 1, saved: 0, failed: 1 });
    });
});

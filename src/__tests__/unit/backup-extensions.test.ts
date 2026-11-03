import { describe, expect, it, vi } from "vitest";
import type { BackupExtension, BackupExportContext, BackupImportContext } from "@/lib/backup-extensions";
import { BACKUP_EXTENSIONS, collectExtensions, importExtensions } from "@/lib/backup-extensions";

function makeExportCtx(): BackupExportContext {
    return { userIds: ["user-1"] };
}

function makeImportCtx(): BackupImportContext {
    return {
        tx: {} as BackupImportContext["tx"],
        userIdMap: () => "user-1",
        subjectIdMap: new Map(),
        errorItemIdMap: new Map(),
        tagIdMap: new Map(),
        examPaperIdMap: new Map(),
        examQuestionIdMap: new Map(),
    };
}

describe("backup-extensions", () => {
    it("上游默认注册表为空", () => {
        expect(BACKUP_EXTENSIONS).toEqual([]);
    });

    it("collectExtensions 返回每个注册扩展的数据", async () => {
        const ext: BackupExtension = {
            key: "bank-meta",
            version: 1,
            export: vi.fn().mockResolvedValue({ items: [1, 2] }),
            import: vi.fn().mockResolvedValue(0),
        };
        const result = await collectExtensions(makeExportCtx(), [ext]);
        expect(result).toEqual({ "bank-meta": { version: 1, data: { items: [1, 2] } } });
        expect(ext.export).toHaveBeenCalledWith(makeExportCtx());
    });

    it("空注册表导出为 {}", async () => {
        const result = await collectExtensions(makeExportCtx(), []);
        expect(result).toEqual({});
    });

    it("importExtensions 调用已注册扩展并返回条数", async () => {
        const ext: BackupExtension = {
            key: "bank-meta",
            version: 1,
            export: vi.fn(),
            import: vi.fn().mockResolvedValue(5),
        };
        const ctx = makeImportCtx();
        const result = await importExtensions(ctx, { "bank-meta": { version: 1, data: { x: 1 } } }, [ext]);
        expect(result).toEqual({ "bank-meta": 5 });
        expect(ext.import).toHaveBeenCalledWith(ctx, { version: 1, data: { x: 1 } });
    });

    it("importExtensions 跳过未注册 key", async () => {
        const ext: BackupExtension = {
            key: "bank-meta",
            version: 1,
            export: vi.fn(),
            import: vi.fn().mockResolvedValue(0),
        };
        const result = await importExtensions(makeImportCtx(), { unknown: { version: 1, data: null } }, [ext]);
        expect(result).toEqual({});
        expect(ext.import).not.toHaveBeenCalled();
    });

    it("importExtensions 跳过版本过高的 payload", async () => {
        const ext: BackupExtension = {
            key: "bank-meta",
            version: 1,
            export: vi.fn(),
            import: vi.fn().mockResolvedValue(0),
        };
        const result = await importExtensions(makeImportCtx(), { "bank-meta": { version: 2, data: null } }, [ext]);
        expect(result).toEqual({});
        expect(ext.import).not.toHaveBeenCalled();
    });

    it("importExtensions 跳过非对象输入", async () => {
        const ext: BackupExtension = {
            key: "bank-meta",
            version: 1,
            export: vi.fn(),
            import: vi.fn().mockResolvedValue(0),
        };
        expect(await importExtensions(makeImportCtx(), null, [ext])).toEqual({});
        expect(await importExtensions(makeImportCtx(), "string", [ext])).toEqual({});
        expect(await importExtensions(makeImportCtx(), [1, 2], [ext])).toEqual({});
        expect(await importExtensions(makeImportCtx(), { "bank-meta": "bad" }, [ext])).toEqual({});
        expect(await importExtensions(makeImportCtx(), { "bank-meta": { version: "1", data: null } }, [ext])).toEqual({});
        expect(ext.import).not.toHaveBeenCalled();
    });

    it("importExtensions 扩展抛错向上传播", async () => {
        const ext: BackupExtension = {
            key: "bank-meta",
            version: 1,
            export: vi.fn(),
            import: vi.fn().mockRejectedValue(new Error("db error")),
        };
        await expect(
            importExtensions(makeImportCtx(), { "bank-meta": { version: 1, data: null } }, [ext]),
        ).rejects.toThrow("db error");
    });

    it("importExtensions 允许缺失 extensions 字段（旧版文件）", async () => {
        const result = await importExtensions(makeImportCtx(), undefined, []);
        expect(result).toEqual({});
    });
});

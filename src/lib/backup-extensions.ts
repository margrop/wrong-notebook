import type { Prisma } from "@prisma/client";
import { createLogger } from "@/lib/logger";

const logger = createLogger("backup-extensions");

/** 导出上下文：userIds 为 null 表示管理员导出全部用户 */
export interface BackupExportContext {
    userIds: string[] | null;
}

/** 导入上下文：ID 映射以导入路由中实际存在的映射为准 */
export interface BackupImportContext {
    tx: Prisma.TransactionClient;
    /** 旧用户 ID → 新用户 ID；与核心数据规则一致：管理员全量导入保留原用户 ID，非管理员导入映射到当前用户 */
    userIdMap: (oldUserId: string) => string | undefined;
    subjectIdMap: ReadonlyMap<string, string>;
    errorItemIdMap: ReadonlyMap<string, string>;
    tagIdMap: ReadonlyMap<string, string>;
    examPaperIdMap: ReadonlyMap<string, string>;
    examQuestionIdMap: ReadonlyMap<string, string>;
}

export interface BackupExtension {
    /** 小写字母数字与短横线 */
    key: string;
    /** 扩展自身版本号 */
    version: number;
    export(ctx: BackupExportContext): Promise<unknown>;
    /** 返回导入条数 */
    import(ctx: BackupImportContext, payload: { version: number; data: unknown }): Promise<number>;
}

/** 上游为空；fork 项目在此注册自己的扩展 */
export const BACKUP_EXTENSIONS: BackupExtension[] = [];

/** 导出所有已注册扩展的数据 */
export async function collectExtensions(
    ctx: BackupExportContext,
    registry: BackupExtension[] = BACKUP_EXTENSIONS,
): Promise<Record<string, { version: number; data: unknown }>> {
    const result: Record<string, { version: number; data: unknown }> = {};
    for (const ext of registry) {
        result[ext.key] = { version: ext.version, data: await ext.export(ctx) };
    }
    return result;
}

/**
 * 导入扩展数据。未知 key 跳过并 warn；扩展版本低于文件版本（新版文件导入旧程序）跳过并 warn；
 * 扩展 import 抛错向上传播，由调用方决定回滚。
 */
export async function importExtensions(
    ctx: BackupImportContext,
    raw: unknown,
    registry: BackupExtension[] = BACKUP_EXTENSIONS,
): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return stats;
    }
    const entries = raw as Record<string, unknown>;
    for (const [key, payload] of Object.entries(entries)) {
        const ext = registry.find((e) => e.key === key);
        if (!ext) {
            logger.warn({ key }, "Skipping unknown backup extension");
            continue;
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            logger.warn({ key }, "Skipping malformed backup extension payload");
            continue;
        }
        const { version, data } = payload as { version?: unknown; data?: unknown };
        if (typeof version !== "number" || version > ext.version) {
            logger.warn({ key, version, extVersion: ext.version }, "Skipping newer backup extension version");
            continue;
        }
        stats[key] = await ext.import(ctx, { version, data });
    }
    return stats;
}

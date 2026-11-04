/**
 * 备份导入写库侧的共享类型。
 */
import type { Prisma } from "@prisma/client";
import type { NormalizedImportData } from "@/lib/backup/import-parser";

/** 导入统计，随响应返回 */
export interface ImportStats {
    subjectsCreated: number;
    tagsCreated: number;
    errorItemsCreated: number;
    reviewSchedulesCreated: number;
    examPapersCreated: number;
    preferencesRestored: boolean;
    practiceRecordsCreated: number;
    tagsLinked: number;
    duplicateErrorItems: number;
    ttsSpeechesImported: number;
    importTasksCreated: number;
    importBatchesCreated: number;
    extensionsImported: Record<string, number>;
}

/** 贯穿整个导入过程的上下文：事务客户端、目标用户、全部 ID 映射与统计 */
export interface ImportContext {
    tx: Prisma.TransactionClient;
    /** 当前登录用户 */
    user: { id: string; email: string };
    /** 管理员全量导入时保留导出文件中的用户 ID */
    importAll: boolean;
    normalized: NormalizedImportData;
    stats: ImportStats;
    /** 需重新评估掌握概率的错题新 ID（含重复题合并到的原题） */
    masteryIds: Set<string>;
    /** 已带掌握概率导入的新题无需重新评估 */
    evaluatedIds: Set<string>;
    // 各步骤逐步填充的 ID 映射（旧 ID → 新 ID）
    subjectIdMap: Map<string, string>;
    systemTagIdMap: Map<string, string>;
    tagIdMap: Map<string, string>;
    /** subject ID → tagSet，用于错题按错题本 tagSet 匹配系统标签 */
    subjectTagSetMap: Map<string, string>;
    /** (tagSet, name) → 标签 ID，按错题本 tagSet 精确匹配 */
    tagBySetAndName: Map<string, string>;
    /** name → 标签 ID，兼容旧版导出文件不区分 tagSet 时按名字兜底 */
    tagNameMap: Map<string, string>;
    paperGroupIdMap: Map<string, string>;
    /** 旧版备份的默认卷别分组：userId:key → 分组 ID */
    legacyLevelMap: Map<string, string>;
    errorItemIdMap: Map<string, string>;
    errorItemOwnerMap: Map<string, string>;
    examPaperIdMap: Map<string, string>;
    examQuestionIdMap: Map<string, string>;
    examQuestionOwnerMap: Map<string, string>;
}

export interface ImportWriterOptions {
    tx: Prisma.TransactionClient;
    /** 当前登录用户 */
    user: { id: string; email: string };
    /** 管理员全量导入时保留导出文件中的用户 ID */
    importAll: boolean;
    normalized: NormalizedImportData;
}

export interface ImportWriterResult {
    stats: ImportStats;
    /** 需重新评估掌握概率的错题新 ID（含重复题合并到的原题） */
    masteryIds: string[];
}

export function createImportContext({ tx, user, importAll, normalized }: ImportWriterOptions): ImportContext {
    return {
        tx,
        user,
        importAll,
        normalized,
        stats: {
            subjectsCreated: 0,
            tagsCreated: 0,
            errorItemsCreated: 0,
            reviewSchedulesCreated: 0,
            examPapersCreated: 0,
            preferencesRestored: false,
            practiceRecordsCreated: 0,
            tagsLinked: 0,
            duplicateErrorItems: 0,
            ttsSpeechesImported: 0,
            importTasksCreated: 0,
            importBatchesCreated: 0,
            extensionsImported: {},
        },
        masteryIds: new Set<string>(),
        evaluatedIds: new Set<string>(),
        subjectIdMap: new Map<string, string>(),
        systemTagIdMap: new Map<string, string>(),
        tagIdMap: new Map<string, string>(),
        subjectTagSetMap: new Map<string, string>(),
        tagBySetAndName: new Map<string, string>(),
        tagNameMap: new Map<string, string>(),
        paperGroupIdMap: new Map<string, string>(),
        legacyLevelMap: new Map<string, string>(),
        errorItemIdMap: new Map<string, string>(),
        errorItemOwnerMap: new Map<string, string>(),
        examPaperIdMap: new Map<string, string>(),
        examQuestionIdMap: new Map<string, string>(),
        examQuestionOwnerMap: new Map<string, string>(),
    };
}

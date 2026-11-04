/**
 * 导入步骤：偏好设置还原与学科（错题本）映射。
 */
import { resolveNotebookScope } from "@/lib/notebook-scope";
import type { ImportContext } from "./types";

/** 0. 偏好设置只在导出文件属于当前账户时还原 */
export async function importPreferences(ctx: ImportContext): Promise<void> {
    const { tx, user, normalized, stats } = ctx;
    if (normalized.hasPreferences) {
        await tx.user.update({ where: { id: user.id }, data: normalized.preferences });
        stats.preferencesRestored = true;
    }
}

/** 1. 导入 subjects，建立导出 ID → 现有/新建 ID 的映射 */
export async function importSubjects(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, stats, subjectIdMap } = ctx;
    for (const subject of normalized.subjects) {
        const targetUserId = importAll ? subject.userId : user.id;
        const existing = await tx.subject.findFirst({
            where: { name: subject.name, userId: targetUserId },
        });
        if (existing) {
            subjectIdMap.set(subject.id, existing.id);
        } else {
            // 旧版导出文件没有学段和学科：学段按小学，学科由名称推断
            const scope = resolveNotebookScope(subject);
            const created = await tx.subject.create({
                data: {
                    name: subject.name,
                    stage: scope.stage,
                    subjectKey: scope.subject,
                    tagSet: subject.tagSet || 'default',
                    userId: targetUserId,
                },
            });
            subjectIdMap.set(subject.id, created.id);
            stats.subjectsCreated++;
        }
    }
}

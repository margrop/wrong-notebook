/**
 * 导入步骤：练习记录与掌握阈值同步。
 */
import { sanitizeFigureSvg } from "@/lib/figure-svg";
import { syncMasteryLevels } from "@/lib/mastery";
import type { ImportContext } from "./types";

/** 7. 导入 practice records */
export async function importPracticeRecords(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, stats, masteryIds, evaluatedIds, errorItemIdMap, errorItemOwnerMap, examQuestionIdMap, examQuestionOwnerMap } = ctx;
    for (const record of normalized.practiceRecords) {
        const { raw } = record;
        const targetUserId = importAll ? raw.userId : user.id;
        const errorItemId = raw.errorItemId && errorItemOwnerMap.get(raw.errorItemId) === targetUserId
            ? errorItemIdMap.get(raw.errorItemId) : undefined;
        const examQuestionId = raw.examQuestionId && examQuestionOwnerMap.get(raw.examQuestionId) === targetUserId
            ? examQuestionIdMap.get(raw.examQuestionId) : undefined;
        await tx.practiceRecord.create({
            data: {
                userId: targetUserId,
                subject: raw.subject,
                difficulty: raw.difficulty,
                isCorrect: raw.isCorrect,
                ...(errorItemId ? {
                    errorItemId,
                    result: record.result,
                    questionText: raw.questionText,
                    answerText: raw.answerText,
                    analysis: raw.analysis,
                    wrongAnswerText: raw.wrongAnswerText,
                    mistakeAnalysis: raw.mistakeAnalysis,
                    originalImageUrl: raw.originalImageUrl,
                    figureSvg: sanitizeFigureSvg(raw.figureSvg),
                    source: record.source,
                    examQuestionId,
                } : {}),
                createdAt: record.createdAt,
            },
        });
        stats.practiceRecordsCreated++;
        if (errorItemId && record.result && !evaluatedIds.has(errorItemId)) masteryIds.add(errorItemId);
    }
}

/** 9. 还原了已掌握阈值时，按新阈值同步该账户全部错题的 masteryLevel */
export async function syncMasteryThreshold(ctx: ImportContext): Promise<void> {
    const { tx, user, normalized } = ctx;
    if (typeof normalized.preferences.masteryThreshold === 'number') {
        await syncMasteryLevels(tx, user.id, normalized.preferences.masteryThreshold);
    }
}

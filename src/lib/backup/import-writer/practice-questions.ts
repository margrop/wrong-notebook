/**
 * 导入步骤：智能练习生成题。
 */
import { EXAM_DIFFICULTIES } from "@/lib/exam/exam";
import type { ImportContext } from "./types";

const PRACTICE_SOURCES = ['ai', 'bank', 'bankVariant'] as const;

/** 6.1 导入独立生成题，并建立旧 ID → 新 ID 映射供练习记录引用 */
export async function importPracticeQuestions(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, stats, errorItemIdMap, errorItemOwnerMap, practiceQuestionIdMap, practiceQuestionOwnerMap } = ctx;
    for (const question of normalized.practiceQuestions) {
        const { raw } = question;
        const targetUserId = importAll ? raw.userId : user.id;
        const errorItemId = raw.errorItemId && errorItemOwnerMap.get(raw.errorItemId) === targetUserId
            ? errorItemIdMap.get(raw.errorItemId) : undefined;
        const createdAt = question.createdAt ?? question.generatedAt ?? new Date();
        const created = await tx.practiceQuestion.create({
            data: {
                userId: targetUserId,
                ...(errorItemId ? { errorItemId } : {}),
                subject: raw.subject,
                difficulty: (EXAM_DIFFICULTIES as readonly string[]).includes(raw.difficulty ?? '') ? raw.difficulty : null,
                source: (PRACTICE_SOURCES as readonly string[]).includes(raw.source) ? raw.source : 'ai',
                questionText: raw.questionText,
                answerText: raw.answerText,
                analysis: raw.analysis,
                figureSvg: question.figureSvg,
                generatedAt: question.generatedAt ?? createdAt,
                createdAt,
            },
        });
        practiceQuestionIdMap.set(raw.id, created.id);
        practiceQuestionOwnerMap.set(raw.id, targetUserId);
        stats.practiceQuestionsCreated++;
    }
}

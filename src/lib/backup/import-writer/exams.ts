/**
 * 导入步骤：复习计划与试卷（含题目）。
 */
import { summarizePaperStatus } from "@/lib/exam/exam";
import { sanitizeFigureSvg } from "@/lib/figure-svg";
import { normalizeFigureAlign, normalizeFigureScale } from "@/lib/figure-scale";
import { normalizeCustomAnswerSpacePx } from "@/lib/exam/exam-answer-space";
import { normalizeExamScore } from "@/lib/exam/exam-score";
import { normalizeQuestionType } from "@/lib/question/question-type";
import { mapSubjectIds } from "@/lib/backup/import-parser";
import type { ImportContext } from "./types";

/** 5. 导入 review schedules */
export async function importReviewSchedules(ctx: ImportContext): Promise<void> {
    const { tx, normalized, stats, errorItemIdMap } = ctx;
    for (const schedule of normalized.reviewSchedules) {
        const newErrorItemId = errorItemIdMap.get(schedule.raw.errorItemId);
        if (newErrorItemId && schedule.scheduledFor) {
            // 去重：同一 errorItem + 相同 scheduledFor 视为重复
            const existingSchedule = await tx.reviewSchedule.findFirst({
                where: {
                    errorItemId: newErrorItemId,
                    scheduledFor: schedule.scheduledFor,
                },
            });
            if (existingSchedule) continue;

            await tx.reviewSchedule.create({
                data: {
                    errorItemId: newErrorItemId,
                    scheduledFor: schedule.scheduledFor,
                    completedAt: schedule.completedAt,
                    isCorrect: schedule.raw.isCorrect,
                },
            });
            stats.reviewSchedulesCreated++;
        }
    }
}

/** 6. 导入试卷：同一用户下标题和创建时间都相同视为已导入过，只建立题目映射 */
export async function importExamPapers(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, stats, examPaperIdMap, examQuestionIdMap, examQuestionOwnerMap, subjectIdMap, errorItemIdMap, errorItemOwnerMap } = ctx;
    for (const paper of normalized.examPapers) {
        const { raw } = paper;
        const targetUserId = importAll ? raw.userId : user.id;
        const questions = Array.isArray(raw.questions) ? raw.questions : [];
        const existing = paper.createdAt && await tx.examPaper.findFirst({
            where: { userId: targetUserId, title: raw.title, createdAt: paper.createdAt },
            select: { id: true, questions: { select: { id: true, order: true } } },
        });
        if (existing) {
            examPaperIdMap.set(raw.id, existing.id);
            for (const question of questions) {
                const matched = existing.questions.find((candidate) => candidate.order === question.order);
                if (matched) {
                    examQuestionIdMap.set(question.id, matched.id);
                    examQuestionOwnerMap.set(question.id, targetUserId);
                }
            }
            continue;
        }

        const created = await tx.examPaper.create({
            data: {
                userId: targetUserId,
                title: String(raw.title || ''),
                status: paper.statuses.length > 0 ? summarizePaperStatus(paper.statuses) : 'failed',
                scope: paper.scope,
                mode: paper.mode,
                difficulty: paper.difficulty,
                requestedCount: paper.requestedCount,
                subjectIds: mapSubjectIds(raw.subjectIds, subjectIdMap),
                tagNames: paper.tagNames,
                groupByType: paper.groupByType,
                resultsRecordedAt: paper.resultsRecordedAt,
                createdAt: paper.createdAt,
                updatedAt: paper.updatedAt,
            },
        });
        for (const [index, question] of questions.entries()) {
            const errorItemId = question.errorItemId && errorItemOwnerMap.get(question.errorItemId) === targetUserId
                ? errorItemIdMap.get(question.errorItemId) : undefined;
            const createdQuestion = await tx.examQuestion.create({
                data: {
                    paperId: created.id,
                    order: Number.isInteger(question.order) ? question.order : index,
                    errorItemId,
                    sourceShortId: String(question.sourceShortId || ''),
                    status: paper.statuses[index],
                    questionText: question.questionText,
                    answerText: question.answerText,
                    analysis: question.analysis,
                    figureSvg: sanitizeFigureSvg(question.figureSvg),
                    figureScale: normalizeFigureScale(question.figureScale),
                    figureAlign: normalizeFigureAlign(question.figureAlign),
                    answerSpacePx: normalizeCustomAnswerSpacePx(question.answerSpacePx),
                    score: normalizeExamScore(question.score ?? null),
                    questionType: normalizeQuestionType(question.questionType),
                    error: question.error,
                },
            });
            examQuestionIdMap.set(question.id, createdQuestion.id);
            examQuestionOwnerMap.set(question.id, targetUserId);
        }
        examPaperIdMap.set(raw.id, created.id);
        stats.examPapersCreated++;
    }
}

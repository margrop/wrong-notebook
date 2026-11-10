/**
 * 导入步骤：真题库与题库题目（version 14 起）。
 * 题库独立于错题本；按原 ID 去重，名称冲突时追加序号，题目批量写入。
 */
import { safeParseDate } from "@/lib/backup/import-parser";
import type { ImportContext } from "./types";

/** 5. 导入真题库与题目 */
export async function importQuestionBanks(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, stats } = ctx;
    for (const bank of normalized.questionBanks) {
        const targetUserId = importAll ? bank.userId : user.id;
        const existingById = await tx.questionBank.findFirst({
            where: { id: bank.id, userId: targetUserId },
            select: { id: true },
        });
        if (existingById) continue;

        let name = bank.name;
        const byName = await tx.questionBank.findFirst({
            where: { name, userId: targetUserId },
            select: { id: true },
        });
        if (byName) name = `${bank.name}（导入）`.slice(0, 200);

        const created = await tx.questionBank.create({
            data: {
                id: bank.id,
                userId: targetUserId,
                name,
                description: bank.description,
                stage: bank.stage,
                subjectKey: bank.subjectKey,
                gradeRange: bank.gradeRange,
                source: bank.source,
                sourceUrl: bank.sourceUrl,
                license: bank.license,
                formatVersion: bank.formatVersion || 1,
                questionCount: bank.questionCount,
                createdAt: safeParseDate(bank.createdAt),
                updatedAt: safeParseDate(bank.updatedAt),
            },
        });
        stats.questionBanksCreated++;

        const questions = Array.isArray(bank.questions) ? bank.questions : [];
        if (questions.length > 0) {
            await tx.bankQuestion.createMany({
                data: questions.map((question) => ({
                    bankId: created.id,
                    externalId: question.externalId,
                    stage: question.stage,
                    subjectKey: question.subjectKey,
                    grade: question.grade,
                    semester: question.semester,
                    questionType: question.questionType,
                    difficultyStars: question.difficultyStars,
                    text: question.text,
                    material: question.material,
                    optionsJson: question.optionsJson,
                    answer: question.answer,
                    analysis: question.analysis,
                    knowledgePoints: question.knowledgePoints,
                    id: question.id,
                    source: question.source,
                    figureSvg: question.figureSvg,
                    createdAt: safeParseDate(question.createdAt),
                })),
            });
            stats.bankQuestionsCreated += questions.length;
        }
    }
}

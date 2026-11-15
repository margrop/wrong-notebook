/**
 * 导入步骤：真题库与题库题目（version 14 起）。
 * 题库全站共享；按原 ID 去重，名称冲突时追加序号，题目批量写入。
 */
import { safeParseDate } from "@/lib/backup/import-parser";
import type { ImportContext } from "./types";

/** 5. 导入真题库与题目 */
export async function importQuestionBanks(ctx: ImportContext): Promise<void> {
    const { tx, normalized, stats, importAll } = ctx;
    // 题库为全站共享，仅在整站导入（all=true，管理员）时还原；个人与合并导入不写题库
    if (!importAll) return;
    for (const bank of normalized.questionBanks) {
        const existingById = await tx.questionBank.findFirst({
            where: { id: bank.id },
            select: { id: true },
        });
        if (existingById) continue;

        let name = bank.name;
        const byName = await tx.questionBank.findFirst({
            where: { name },
            select: { id: true },
        });
        if (byName) name = `${bank.name}（导入）`.slice(0, 200);

        const created = await tx.questionBank.create({
            data: {
                id: bank.id,
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

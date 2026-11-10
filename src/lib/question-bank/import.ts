/**
 * 真题库导入（服务端）：把题库包写入用户的真题库；可选同时写入错题本。
 * 默认只进入真题库，不产生错题。
 */
import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { SUBJECT_DISPLAY_NAMES, isNotebookSubject } from "@/lib/notebook-scope";
import { saveQuestion } from "@/lib/question/question-save";
import { DEFAULT_FIGURE_ALIGN, DEFAULT_FIGURE_SCALE } from "@/lib/figure-scale";
import type { NormalizedBankQuestion, ParsedBankFile } from "@/lib/question-bank/types";
import type { BankImportResult } from "@/lib/question-bank/types";

const logger = createLogger('question-bank:import');

const GRADE_NAMES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三"];

/** 题目年级学期：按题库的年级与学期生成；高中真题没有学期时按上学期 */
export function bankQuestionGradeSemester(question: Pick<NormalizedBankQuestion, "grade" | "semester">): string | null {
    if (!question.grade || question.grade < 1 || question.grade > 12) return null;
    const name = GRADE_NAMES[question.grade - 1];
    const semester = question.semester?.trim() || "上";
    return `${name}${semester}`;
}

/** 题库单题转为错题题干：公共材料 + 题干 + 选项 */
export function composeBankQuestionText(question: Pick<NormalizedBankQuestion, "text" | "material" | "optionsJson">): string {
    const parts = [question.material?.trim(), question.text.trim()].filter(Boolean) as string[];
    let options: Record<string, string> = {};
    try {
        options = question.optionsJson ? JSON.parse(question.optionsJson) as Record<string, string> : {};
    } catch {
        options = {};
    }
    const optionLines = Object.entries(options)
        .filter(([, value]) => typeof value === "string" && value.trim())
        .map(([key, value]) => `${key}. ${value.trim()}`);
    return [...parts, ...optionLines].join("\n");
}

export interface ImportBankOptions {
    user: User;
    file: ParsedBankFile;
    name?: string | null;
    description?: string | null;
    /** 是否同时写入错题本；默认 false */
    addToErrorItems?: boolean;
    /** 同时写入错题时的目标错题本 */
    notebookId?: string | null;
}

export type ImportBankOutcome =
    | { ok: true; result: BankImportResult }
    | { ok: false; code: "BANK_NAME_EXISTS" | "BANK_EMPTY"; message: string };

/** 导入题库包；名称重复时拒绝，避免覆盖已有题库 */
export async function importQuestionBank(options: ImportBankOptions): Promise<ImportBankOutcome> {
    const { user, file } = options;
    const name = (options.name?.trim() || file.meta.title).slice(0, 200);
    const description = (options.description?.trim() || file.meta.description || "").slice(0, 1000) || null;

    const existing = await prisma.questionBank.findUnique({
        where: { userId_name: { userId: user.id, name } },
        select: { id: true },
    });
    if (existing) {
        return { ok: false, code: "BANK_NAME_EXISTS", message: name };
    }
    if (file.questions.length === 0) {
        return { ok: false, code: "BANK_EMPTY", message: name };
    }

    const bank = await prisma.questionBank.create({
        data: {
            userId: user.id,
            name,
            description,
            stage: file.meta.stage,
            subjectKey: isNotebookSubject(file.meta.subject) ? file.meta.subject : null,
            gradeRange: JSON.stringify(file.meta.grades),
            source: file.meta.source,
            sourceUrl: file.meta.sourceUrl ?? null,
            license: file.meta.license,
            formatVersion: 1,
            questionCount: file.questions.length,
        },
    });

    await prisma.bankQuestion.createMany({
        data: file.questions.map((question) => ({
            bankId: bank.id,
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
            knowledgePoints: JSON.stringify(question.knowledgePoints),
            source: question.source,
            figureSvg: question.figureSvg,
        })),
    });

    let errorItemsCreated = 0;
    let duplicates = 0;
    if (options.addToErrorItems) {
        const notebookId = options.notebookId?.trim() || null;
        for (const question of file.questions) {
            const subjectKey = isNotebookSubject(question.subjectKey) ? question.subjectKey : file.meta.subject;
            const saved = await saveQuestion(user, {
                questionText: composeBankQuestionText(question),
                answerText: question.answer ?? "",
                analysis: question.analysis ?? "",
                knowledgePoints: question.knowledgePoints,
                difficultyStars: question.difficultyStars ?? undefined,
                gradeSemester: bankQuestionGradeSemester(question) ?? undefined,
                figureScale: DEFAULT_FIGURE_SCALE,
                figureAlign: DEFAULT_FIGURE_ALIGN,
                questionType: question.questionType ?? undefined,
                source: question.source ?? undefined,
                figureSvg: question.figureSvg ?? undefined,
                originalImageUrl: "",
                subjectId: notebookId ?? undefined,
                subjectName: notebookId ? undefined : SUBJECT_DISPLAY_NAMES[subjectKey],
                mistakeStatus: "unknown",
            }, { origin: 'manual' });
            if (!saved.ok) {
                logger.warn({ bankId: bank.id, externalId: question.externalId, code: saved.error.code }, 'Bank question failed to save as error item');
                continue;
            }
            if (saved.status === 'duplicate') duplicates++;
            else errorItemsCreated++;
        }
    }

    return {
        ok: true,
        result: {
            bank: {
                id: bank.id,
                name: bank.name,
                description: bank.description,
                stage: bank.stage,
                subjectKey: bank.subjectKey,
                gradeRange: bank.gradeRange,
                source: bank.source,
                sourceUrl: bank.sourceUrl,
                license: bank.license,
                questionCount: bank.questionCount,
                createdAt: bank.createdAt.toISOString(),
                updatedAt: bank.updatedAt.toISOString(),
            },
            errorItemsCreated,
            duplicates,
        },
    };
}

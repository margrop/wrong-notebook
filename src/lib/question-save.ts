/**
 * 保存一道题目为错题：校验卷别、补充年级识别、判重与写入。
 * 「添加错题」接口和识别导入任务共用，保证两条路径的验证、判重与年级/卷别规则一致。
 */
import { NextResponse } from "next/server";
import type { Prisma, User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { prepareImportGrade } from "@/lib/import-question-grade";
import { needsQuestionGradeRecognition } from "@/lib/question-grade";
import { validationError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { resolveOrCreateTags, inferTagScope } from "@/lib/tag-resolver";
import { normalizeMistakeStatusForSave } from "@/lib/mistake-status";
import { generateUniqueShortId } from "@/lib/short-id";
import { resolveNotebookForSubject } from "@/lib/notebook-resolver";
import { scheduleMasteryEvaluation } from "@/lib/mastery";
import { findDuplicateQuestion, recordDuplicateQuestion, runQuestionImportTransaction } from "@/lib/question-deduplication";
import { MAX_FIGURE_SVG_LENGTH, sanitizeFigureSvg } from "@/lib/figure-svg";
import { getDefaultPaperLevelGroupId, ensureDefaultPaperGroups } from "@/lib/paper-level";
import { DEFAULT_FIGURE_ALIGN, DEFAULT_FIGURE_SCALE, FIGURE_ALIGNS, MAX_FIGURE_SCALE, MIN_FIGURE_SCALE } from "@/lib/figure-scale";
import { questionSaveErrorResponse } from "@/lib/question-save-error-response";
import type { QuestionSaveFailureStage } from "@/lib/question-save-error-response";

const logger = createLogger('question-save');

export const importSchema = z.object({
    questionText: z.string().max(20000).nullish(),
    answerText: z.string().max(20000).nullish(),
    analysis: z.string().max(50000).nullish(),
    wrongAnswerText: z.string().max(20000).nullish(),
    mistakeAnalysis: z.string().max(50000).nullish(),
    mistakeStatus: z.string().max(30).nullish(),
    knowledgePoints: z.preprocess(
        (value) => typeof value === 'string' ? value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) : value,
        z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    ),
    originalImageUrl: z.string().max(20 * 1024 * 1024).default(''),
    subjectId: z.string().nullish(),
    subjectName: z.string().max(100).nullish(),
    gradeSemester: z.string().max(100).nullish(),
    recognizedGradeSemester: z.string().max(100).nullish(),
    paperLevel: z.string().max(30).nullish(),
    difficultyStars: z.number().int().min(1).max(5).nullish(),
    hasFigure: z.boolean().optional(),
    figureSvg: z.string().max(MAX_FIGURE_SVG_LENGTH).nullish(),
    figureScale: z.number().int().min(MIN_FIGURE_SCALE).max(MAX_FIGURE_SCALE).default(DEFAULT_FIGURE_SCALE),
    figureAlign: z.enum(FIGURE_ALIGNS).default(DEFAULT_FIGURE_ALIGN),
    geogebraCommands: z.string().nullish(),
});

export type ImportQuestionInput = z.infer<typeof importSchema>;

export interface SaveQuestionOptions {
    /** 在写入错题（或重复题的做错记录）的同一数据库事务内执行；抛错时整笔回滚 */
    afterWrite?: (tx: Prisma.TransactionClient, saved: { id: string; duplicate: boolean }) => Promise<void>;
}

/**
 * 为指定用户保存题目，返回与「添加错题」接口一致的响应：新题 201、重复题 200，失败时为统一错误响应。
 */
export async function saveQuestionForUser(user: User, body: ImportQuestionInput, options: SaveQuestionOptions = {}): Promise<NextResponse> {
    let failureStage: QuestionSaveFailureStage = 'save';
    try {
        return await saveQuestion(user, body, options, (stage) => { failureStage = stage; });
    } catch (error) {
        logger.error({
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
        }, 'Error saving item');
        return questionSaveErrorResponse(error, failureStage);
    }
}

async function saveQuestion(user: User, body: ImportQuestionInput, options: SaveQuestionOptions, setStage: (stage: QuestionSaveFailureStage) => void): Promise<NextResponse> {
    const {
        questionText,
        answerText,
        analysis,
        wrongAnswerText,
        mistakeAnalysis,
        mistakeStatus,
        knowledgePoints,
        originalImageUrl,
        subjectId: requestedSubjectId,
        subjectName,
        paperLevel,
        difficultyStars,
        geogebraCommands,
    } = body;
    // 配图 SVG 入库前再净化一次，无效时丢弃
    const figureSvg = sanitizeFigureSvg(body.figureSvg);
    const hasFigure = !!body.hasFigure || figureSvg !== null;

    // 校验传入的 paperLevel 是否有效（不创建分组，分组在事务内按需创建）
    let resolvedPaperLevel: string | null = null;
    if (paperLevel !== null && paperLevel !== undefined) {
        const group = await prisma.paperGroup.findFirst({
            where: { id: paperLevel, userId: user.id, isActive: true },
            select: { id: true },
        });
        if (!group) {
            return validationError('QUESTION_SAVE_INVALID_PAPER_LEVEL');
        }
        resolvedPaperLevel = group.id;
    }

    const duplicateBeforeRecognition = needsQuestionGradeRecognition(user, body)
        ? await findDuplicateQuestion(prisma, user.id, body) : null;
    setStage(needsQuestionGradeRecognition(user, body) && !duplicateBeforeRecognition ? 'grade' : 'save');
    const gradeResult = await prepareImportGrade(user, body, duplicateBeforeRecognition !== null);
    setStage('save');
    if (gradeResult.response) return gradeResult.response;

    const write = async (tx: Prisma.TransactionClient) => {
        const duplicate = await findDuplicateQuestion(tx, user.id, body);
        if (duplicate) return recordDuplicateQuestion(tx, user.id, duplicate, body);

        // 事务内确保默认分组存在（并发安全），并解析默认卷别
        if (resolvedPaperLevel === null) {
            await ensureDefaultPaperGroups(user.id, tx);
            resolvedPaperLevel = await getDefaultPaperLevelGroupId(user.id, difficultyStars, tx);
        }

        // 未指定错题本时，按学科名匹配或新建错题本
        let subjectId: string | undefined = requestedSubjectId || undefined;
        if (!subjectId && typeof subjectName === 'string' && subjectName.trim()) {
            subjectId = (await resolveNotebookForSubject(user.id, subjectName, tx)).id;
        }

        const finalGradeSemester = gradeResult.gradeSemester;

        // 处理知识点标签（限定在当前错题本的标签体系内）
        const tagNames: string[] = Array.isArray(knowledgePoints) ? knowledgePoints : [];

        // 推断学科与标签体系（与新增错题时一致）
        const subject = await tx.subject.findUnique({ where: { id: subjectId || '' } });
        const { subjectKey, tagSet } = inferTagScope(subject);
        logger.debug({ subjectId, subjectName: subject?.name, subjectKey }, 'Subject inferred');

        const tagConnections = await resolveOrCreateTags(tx, {
            userId: user.id,
            tagNames,
            subjectKey,
            tagSet,
            gradeSemester: finalGradeSemester,
        });

        logger.info({ tagNames, tagConnectionsCount: tagConnections.length }, 'Creating ErrorItem with tags');

        // 创建错题记录
        try {
            const errorItem = await tx.errorItem.create({
                data: {
                    shortId: await generateUniqueShortId(tx),
                    userId: user.id,
                    subjectId: subjectId || undefined,
                    originalImageUrl,
                    questionText,
                    answerText,
                    analysis,
                    wrongAnswerText: wrongAnswerText || null,
                    mistakeAnalysis: mistakeAnalysis || null,
                    mistakeStatus: normalizeMistakeStatusForSave(mistakeStatus, wrongAnswerText),
                    knowledgePoints: JSON.stringify(tagNames),
                    gradeSemester: finalGradeSemester,
                    paperLevel: resolvedPaperLevel,
                    difficultyStars: difficultyStars ?? null,
                    hasFigure,
                    figureSvg,
                    figureScale: body.figureScale,
                    figureAlign: body.figureAlign,
                    geogebraCommands: geogebraCommands || null,
                    masteryLevel: 0,
                    tags: {
                        connect: tagConnections,
                    },
                },
                include: {
                    tags: true,
                    subject: { select: { id: true, name: true } },
                },
            });

            logger.info({ errorItemId: errorItem.id, tagsCount: errorItem.tags?.length || 0 }, 'ErrorItem created successfully');
            return errorItem;
        } catch (dbError) {
            logger.error({
                error: dbError,
                userId: user.id,
                subjectId,
                tagConnectionsCount: tagConnections.length
            }, 'Database error creating ErrorItem');
            throw dbError;
        }
    };
    const result = await runQuestionImportTransaction(async (tx) => {
        const written = await write(tx);
        // 与错题写入同一事务提交：调用方的关联记录（如识别任务标记已保存）失败时整笔回滚
        await options.afterWrite?.(tx, { id: written.id, duplicate: 'duplicate' in written && written.duplicate === true });
        return written;
    });
    const duplicate = 'duplicate' in result && result.duplicate;
    if (duplicate) scheduleMasteryEvaluation([result.id]);
    return NextResponse.json(result, { status: duplicate ? 200 : 201 });
}

/**
 * 保存一道题目为错题的领域逻辑：校验卷别、补充年级识别、判重与写入。
 * 「添加错题」接口和识别导入任务共用，保证两条路径的验证、判重与年级/卷别规则一致。
 * 本模块不依赖 HTTP 层，返回 SaveQuestionResult；HTTP 适配见 question-save-response.ts。
 */
import type { Prisma, User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { prepareImportGrade } from "@/lib/import/import-question-grade";
import { needsQuestionGradeRecognition } from "@/lib/question/question-grade";
import type { QuestionSaveFailure } from "@/lib/question/question-save-failure";
import { classifyQuestionSaveError } from "@/lib/question/question-save-failure";
import { createLogger } from "@/lib/logger";
import { resolveOrCreateTags, inferTagScope } from "@/lib/tags/tag-resolver";
import { normalizeMistakeStatusForSave } from "@/lib/question/mistake-status";
import { generateUniqueShortId } from "@/lib/short-id/short-id";
import { resolveNotebookForSubject } from "@/lib/notebook-resolver";
import { scheduleMasteryEvaluation } from "@/lib/mastery";
import { findDuplicateQuestion, recordDuplicateQuestion, runQuestionImportTransaction } from "@/lib/question/question-deduplication";
import { MAX_FIGURE_SVG_LENGTH, sanitizeFigureSvg } from "@/lib/figure-svg";
import { getDefaultPaperLevelGroupId, ensureDefaultPaperGroups } from "@/lib/paper-level";
import { DEFAULT_FIGURE_ALIGN, DEFAULT_FIGURE_SCALE, FIGURE_ALIGNS, MAX_FIGURE_SCALE, MIN_FIGURE_SCALE } from "@/lib/figure-scale";

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
    /** 追加到 ErrorItem 创建数据中的额外字段（如 ocrText、errorType、source），与默认字段不冲突时使用 */
    extraErrorItemData?: Partial<Prisma.ErrorItemUncheckedCreateInput>;
}

/** 新题写入结果（ErrorItem 记录及其标签、错题本） */
export type SavedQuestionItem = Prisma.ErrorItemGetPayload<{ include: { tags: true; subject: { select: { id: true; name: true } } } }>;

/** 重复题写入结果：保留原有题目记录，并附带本次做错快照信息 */
export type SavedDuplicateItem = SavedQuestionItem & {
    duplicate: true;
    similarity: number;
    mistakeRecorded: true;
    practiceRecordId: string;
    message: string;
};

export type SaveQuestionResult =
    | { ok: true; status: 'created'; item: SavedQuestionItem }
    | { ok: true; status: 'duplicate'; item: SavedDuplicateItem }
    | { ok: false; error: QuestionSaveFailure };

function failure(error: unknown, stage: QuestionSaveFailure['stage']): SaveQuestionResult {
    return { ok: false, error: classifyQuestionSaveError(error, stage) };
}

/**
 * 为指定用户保存题目，返回领域结果：新题 created、重复题 duplicate、失败时携带可公开错误分类。
 * 失败时记录日志；调用方按需转换为 HTTP 响应（见 question-save-response.ts）。
 */
export async function saveQuestion(user: User, body: ImportQuestionInput, options: SaveQuestionOptions = {}): Promise<SaveQuestionResult> {
    let stage: QuestionSaveFailure['stage'] = 'save';
    try {
        return await saveQuestionInner(user, body, options, (next) => { stage = next; });
    } catch (error) {
        logger.error({
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
        }, 'Error saving item');
        return failure(error, stage);
    }
}

async function saveQuestionInner(user: User, body: ImportQuestionInput, options: SaveQuestionOptions, setStage: (stage: QuestionSaveFailure['stage']) => void): Promise<SaveQuestionResult> {
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
            return {
                ok: false,
                error: {
                    code: 'QUESTION_SAVE_INVALID_PAPER_LEVEL',
                    stage: 'save',
                    status: 400,
                    errorCode: 'VALIDATION_ERROR',
                },
            };
        }
        resolvedPaperLevel = group.id;
    }

    const duplicateBeforeRecognition = needsQuestionGradeRecognition(user, body)
        ? await findDuplicateQuestion(prisma, user.id, body) : null;
    setStage(needsQuestionGradeRecognition(user, body) && !duplicateBeforeRecognition ? 'grade' : 'save');
    const gradeResult = await prepareImportGrade(user, body, duplicateBeforeRecognition !== null);
    setStage('save');
    if (!gradeResult.ok) return { ok: false, error: gradeResult.failure };

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
                    ...options.extraErrorItemData,
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
    const duplicate = 'duplicate' in result && result.duplicate === true;
    if (duplicate) scheduleMasteryEvaluation([result.id]);
    return duplicate
        ? { ok: true, status: 'duplicate', item: result as SavedDuplicateItem }
        : { ok: true, status: 'created', item: result };
}

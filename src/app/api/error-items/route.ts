import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { prepareImportGrade } from "@/lib/import-question-grade";
import { needsQuestionGradeRecognition } from "@/lib/question-grade";
import { unauthorized, validationError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { findParentTagIdForGrade } from "@/lib/tag-recognition";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
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

const logger = createLogger('api:error-items');

const importSchema = z.object({
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

export async function POST(req: Request) {
    logger.info('POST /api/error-items called');

    let failureStage: QuestionSaveFailureStage = 'save';
    try {
        const session = await getServerSession(authOptions);
        const parsed = importSchema.safeParse(await req.json());
        if (!parsed.success) return validationError('QUESTION_SAVE_INVALID_INPUT', parsed.error.issues);
        const body = parsed.data;
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
            gradeSemester,
            paperLevel,
            difficultyStars,
            geogebraCommands,
        } = body;
        // 配图 SVG 入库前再净化一次，无效时丢弃
        const figureSvg = sanitizeFigureSvg(body.figureSvg);
        const hasFigure = !!body.hasFigure || figureSvg !== null;

        // 记录请求参数（不记录完整图片数据）
        logger.debug({
            hasQuestionText: !!questionText,
            questionTextLength: questionText?.length || 0,
            hasAnswerText: !!answerText,
            hasAnalysis: !!analysis,
            hasWrongAnswerText: !!wrongAnswerText,
            hasMistakeAnalysis: !!mistakeAnalysis,
            mistakeStatus,
            knowledgePointsCount: Array.isArray(knowledgePoints) ? knowledgePoints.length : 0,
            hasImage: !!originalImageUrl,
            imageSize: originalImageUrl?.length || 0,
            subjectId: requestedSubjectId,
            subjectName,
            gradeSemester,
            paperLevel,
            hasGeogebraCommands: !!geogebraCommands,
        }, 'Request parameters received');

        // 查找用户
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
            logger.debug({ userId: user?.id, email: session.user.email }, 'User lookup result');
        } else {
            logger.warn('No session email found');
        }

        if (!user) {
            logger.warn({ sessionEmail: session?.user?.email }, 'User not found in DB');
            return unauthorized("No user found in DB");
        }

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
        failureStage = needsQuestionGradeRecognition(user, body) && !duplicateBeforeRecognition ? 'grade' : 'save';
        const gradeResult = await prepareImportGrade(user, body, duplicateBeforeRecognition !== null);
        failureStage = 'save';
        if (gradeResult.response) return gradeResult.response;

        const result = await runQuestionImportTransaction(async (tx) => {
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

            // 处理知识点标签
            const tagNames: string[] = Array.isArray(knowledgePoints) ? knowledgePoints : [];
            const tagConnections: { id: string }[] = [];

            // 推断学科
            const subject = await tx.subject.findUnique({ where: { id: subjectId || '' } });
            const subjectKey = inferSubjectFromName(subject?.name ?? null) || 'other';
            logger.debug({ subjectId, subjectName: subject?.name, subjectKey }, 'Subject inferred');

            // 处理每个标签（限定在当前错题本的标签体系内）
            const notebookTagSet = subject?.tagSet || 'default';
            for (const tagName of tagNames) {
                try {
                    let tag = await tx.knowledgeTag.findFirst({
                        where: {
                            name: tagName,
                            tagSet: notebookTagSet,
                            OR: [
                                { isSystem: true },
                                { userId: user.id },
                            ],
                        },
                    });

                    if (!tag) {
                        const parentId = await findParentTagIdForGrade(finalGradeSemester, subjectKey, tx, notebookTagSet);
                        logger.debug({ tagName, parentId, subjectKey, tagSet: notebookTagSet }, 'Creating new custom tag');

                        tag = await tx.knowledgeTag.create({
                            data: {
                                name: tagName,
                                subject: subjectKey,
                                isSystem: false,
                                userId: user.id,
                                parentId: parentId,
                                tagSet: notebookTagSet,
                            },
                        });
                        logger.debug({ tagId: tag.id, tagName }, 'Custom tag created');
                    } else {
                        logger.debug({ tagId: tag.id, tagName, isSystem: tag.isSystem }, 'Existing tag found');
                    }

                    tagConnections.push({ id: tag.id });
                } catch (tagError) {
                    logger.error({ tagName, error: tagError }, 'Error processing tag');
                    throw tagError;
                }
            }

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
        });
        const duplicate = 'duplicate' in result && result.duplicate;
        if (duplicate) scheduleMasteryEvaluation([result.id]);
        return NextResponse.json(result, { status: duplicate ? 200 : 201 });
    } catch (error) {
        logger.error({
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
        }, 'Error saving item');
        return questionSaveErrorResponse(error, failureStage);
    }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { forbidden, notFound, badRequest, validationError, internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { resolveOrCreateTags, inferTagScope } from "@/lib/tags/tag-resolver";
import { normalizeMistakeStatusForSave } from "@/lib/question/mistake-status";
import { getDefaultPaperLevelGroupId } from "@/lib/paper-level";
import { isValidFigureAlign, isValidFigureScale } from "@/lib/figure-scale";
import { updateErrorItemSchema } from "@/lib/schemas/error-items";

const logger = createLogger('api:error-items:id');

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withUser(async (_req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;

    try {
        const errorItem = await prisma.errorItem.findUnique({
            where: {
                id: id,
            },
            include: {
                subject: true,
                tags: true, // 包含标签关联
            },
        });

        if (!errorItem) {
            return notFound("Item not found");
        }

        // Ensure the user owns this item
        if (errorItem.userId !== user.id) {
            return forbidden("Not authorized to access this item");
        }

        return NextResponse.json(errorItem);
    } catch (error) {
        logger.error({ error }, 'Error fetching item');
        return internalError("Failed to fetch error item");
    }
});

export const PUT = withUser(async (req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;

    try {
        const parsed = updateErrorItemSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return validationError("Invalid request body", parsed.error.issues);
        }
        const { knowledgePoints, gradeSemester, paperLevel, questionText, answerText, analysis, subjectId,  wrongAnswerText, mistakeAnalysis, mistakeStatus, geogebraCommands, difficultyStars } = parsed.data;
        const { figureScale, figureAlign } = parsed.data;
        if (figureScale !== undefined && !isValidFigureScale(figureScale)) {
            return badRequest("figureScale must be an integer from 10 to 200");
        }
        if (figureAlign !== undefined && !isValidFigureAlign(figureAlign)) {
            return badRequest("figureAlign must be left, center, or right");
        }
        // 难度星级：1~5 的整数，null 表示清除
        if (difficultyStars !== undefined && difficultyStars !== null
            && !(Number.isInteger(difficultyStars) && difficultyStars >= 1 && difficultyStars <= 5)) {
            return badRequest("difficultyStars must be an integer from 1 to 5");
        }

        const errorItem = await prisma.errorItem.findUnique({
            where: { id },
            include: { subject: true },
        });

        if (!errorItem) {
            return notFound("Item not found");
        }

        if (errorItem.userId !== user.id) {
            return forbidden("Not authorized to update this item");
        }

        // 构建更新数据
        const updateData: Prisma.ErrorItemUncheckedUpdateInput = {};
        if (figureScale !== undefined) updateData.figureScale = figureScale;
        if (figureAlign !== undefined) updateData.figureAlign = figureAlign;
        if (gradeSemester !== undefined) updateData.gradeSemester = gradeSemester;
        if (paperLevel !== undefined) {
            if (paperLevel !== null) {
                const group = await prisma.paperGroup.findFirst({
                    where: { id: paperLevel, userId: user.id, isActive: true },
                    select: { id: true },
                });
                if (!group) {
                    return badRequest("Invalid paperLevel");
                }
            }
            updateData.paperLevel = paperLevel;
        } else if (!errorItem.paperLevel) {
            const defaultPaperLevel = await getDefaultPaperLevelGroupId(user.id, difficultyStars);
            if (defaultPaperLevel) updateData.paperLevel = defaultPaperLevel;
        }
        if (questionText !== undefined) updateData.questionText = questionText;
        if (answerText !== undefined) updateData.answerText = answerText;
        if (analysis !== undefined) updateData.analysis = analysis;
        if (wrongAnswerText !== undefined) updateData.wrongAnswerText = wrongAnswerText || null;
        if (mistakeAnalysis !== undefined) updateData.mistakeAnalysis = mistakeAnalysis || null;
        if (subjectId !== undefined) {
            // 验证目标错题本存在且属于该用户
            const targetSubject = await prisma.subject.findUnique({ where: { id: subjectId } });
            if (!targetSubject || targetSubject.userId !== user.id) {
                return forbidden("Not authorized to move to this notebook");
            }
            updateData.subjectId = subjectId === "" ? null : subjectId;
        }
        if (mistakeStatus !== undefined || wrongAnswerText !== undefined || mistakeAnalysis !== undefined) {
            const nextWrongAnswerText = wrongAnswerText !== undefined ? wrongAnswerText : errorItem.wrongAnswerText;
            // 只改错因分析或错误解答时沿用原作答状态
            updateData.mistakeStatus = normalizeMistakeStatusForSave(
                mistakeStatus !== undefined ? mistakeStatus : errorItem.mistakeStatus,
                nextWrongAnswerText
            );
        }
        if (geogebraCommands !== undefined) updateData.geogebraCommands = geogebraCommands || null;
        if (difficultyStars !== undefined) updateData.difficultyStars = difficultyStars;

        logger.info({ id }, 'Updating error item');

        // 将「解析标签 + 更新错题记录（含标签 set/connect）」放入同一事务，保证中途失败不会留下新建的孤立标签或半更新状态
        const updated = await prisma.$transaction(async (tx) => {
            // 处理 knowledgePoints (标签)
            if (knowledgePoints !== undefined) {
                const tagNames: string[] = Array.isArray(knowledgePoints)
                    ? knowledgePoints
                    : typeof knowledgePoints === 'string'
                        ? JSON.parse(knowledgePoints)
                        : [];

                // 推断学科和标签体系
                const { subjectKey, tagSet } = inferTagScope(errorItem.subject);

                // gradeSemester 上下文取法保持原逻辑：请求中提供的优先，否则用错题已有的
                const contextGrade = gradeSemester !== undefined ? gradeSemester : errorItem.gradeSemester;

                const tagConnections = await resolveOrCreateTags(tx, {
                    userId: user.id,
                    tagNames,
                    subjectKey,
                    tagSet,
                    gradeSemester: contextGrade,
                });

                // 更新标签关联: 先断开所有，再连接新的
                updateData.tags = {
                    set: [], // 先清空
                    connect: tagConnections,
                };

                // 保留旧字段兼容
                updateData.knowledgePoints = JSON.stringify(tagNames);
            }

            return tx.errorItem.update({
                where: { id },
                data: updateData,
                include: { tags: true },
            });
        });

        return NextResponse.json(updated);
    } catch (error) {
        logger.error({ error }, 'Error updating item');
        return internalError("Failed to update error item");
    }
});

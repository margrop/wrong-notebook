import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notFound, validationError, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { generateExamPaper, isPaperGenerating } from "@/lib/exam/exam";
import { FIGURE_ALIGNS, MAX_FIGURE_SCALE, MIN_FIGURE_SCALE, normalizeFigureAlign, normalizeFigureScale } from "@/lib/figure-scale";
import type { FigureAlign } from "@/lib/figure-scale";
import { MAX_CUSTOM_ANSWER_SPACE_PX, MIN_CUSTOM_ANSWER_SPACE_PX, normalizeCustomAnswerSpacePx } from "@/lib/exam/exam-answer-space";
import { MAX_EXAM_SCORE, MIN_EXAM_SCORE, normalizeExamScore } from "@/lib/exam/exam-score";
import { normalizeQuestionType } from "@/lib/question/question-type";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:exams:id');

const updateFigureSchema = z.object({
    figureScale: z.number().int().min(MIN_FIGURE_SCALE).max(MAX_FIGURE_SCALE).optional(),
    figureAlign: z.enum(FIGURE_ALIGNS).optional(),
    // 题下留白手动值；null 表示恢复按全局留白档位
    answerSpacePx: z.number().int().min(MIN_CUSTOM_ANSWER_SPACE_PX).max(MAX_CUSTOM_ANSWER_SPACE_PX).nullable().optional(),
    questionId: z.string().min(1).optional(),
}).refine((data) => data.figureScale !== undefined || data.figureAlign !== undefined || data.answerSpacePx !== undefined, {
    message: "figureScale, figureAlign or answerSpacePx is required",
});

/** 分值最多一位小数（如 2.5）；null 表示清空分值 */
const examScoreSchema = z.number()
    .min(MIN_EXAM_SCORE)
    .max(MAX_EXAM_SCORE)
    .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) <= 1e-6, {
        message: "score allows at most one decimal place",
    });

const updateScoreSchema = z.object({
    // 单题分值；null 表示清空该题分值
    score: examScoreSchema.nullable().optional(),
    questionId: z.string().min(1).optional(),
}).refine((data) => data.score !== undefined, {
    message: "score is required",
});

/** 按题型分大题开关；与配图、分值更新互不影响 */
const updateGroupByTypeSchema = z.object({
    groupByType: z.boolean(),
}).strict();

/**
 * GET /api/exams/:id
 * 试卷详情，含每题内容、来源短 ID 与历次录入的结果
 */
export const GET = withUser(async (
    _req: Request,
    { user, params }: AuthenticatedContext & { params: Promise<{ id: string }> }
) => {
    const { id } = await params;

    try {
        const paper = await prisma.examPaper.findUnique({
            where: { id },
            include: {
                questions: {
                    orderBy: { order: 'asc' },
                    include: {
                        errorItem: { select: { id: true, questionType: true, subject: { select: { name: true } } } },
                        practiceRecords: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, result: true, createdAt: true } },
                    },
                },
            },
        });
        if (!paper || paper.userId !== user.id) {
            return notFound("Exam paper not found");
        }

        // 服务重启会中断后台生成，查看时自动续上
        if (paper.status === 'generating' && !isPaperGenerating(paper.id)) {
            void generateExamPaper(paper.id);
        }

        const { userId: _userId, questions, ...rest } = paper;
        return NextResponse.json({
            ...rest,
            questions: questions.map(({ errorItem, practiceRecords, ...question }) => ({
                ...question,
                figureScale: normalizeFigureScale(question.figureScale),
                figureAlign: normalizeFigureAlign(question.figureAlign),
                answerSpacePx: normalizeCustomAnswerSpacePx(question.answerSpacePx),
                score: normalizeExamScore(question.score ?? null),
                questionType: normalizeQuestionType(question.questionType),
                errorItemQuestionType: normalizeQuestionType(errorItem?.questionType),
                notebookName: errorItem?.subject?.name ?? null,
                attempts: practiceRecords,
            })),
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching exam paper');
        return internalError("Failed to fetch exam paper");
    }
});

/**
 * PATCH /api/exams/:id
 * 保存试卷配图显示与打印比例、位置及题下留白：指定 questionId 时只改单题，未指定时统一修改本卷全部题目。
 * 保存试卷题目分值：指定 questionId 时只改单题（score 为 null 时清空该题分值），未指定时统一设置本卷全部题目分值。
 */
export const PATCH = withUser(async (
    req: Request,
    { user, params }: AuthenticatedContext & { params: Promise<{ id: string }> }
) => {
    const { id } = await params;

    try {
        const body: unknown = await req.json().catch(() => ({}));

        // 按题型分大题开关：请求体含 groupByType 时走此分支（与其他分支互斥，多余字段视为非法）
        if (typeof body === 'object' && body !== null && 'groupByType' in body) {
            const groupParsed = updateGroupByTypeSchema.safeParse(body);
            if (!groupParsed.success) {
                return validationError("Invalid exam paper update", groupParsed.error.issues);
            }
            const paper = await prisma.examPaper.findUnique({ where: { id }, select: { userId: true } });
            if (!paper || paper.userId !== user.id) {
                return notFound("Exam paper not found");
            }
            await prisma.examPaper.update({
                where: { id },
                data: { groupByType: groupParsed.data.groupByType },
            });
            return NextResponse.json({ groupByType: groupParsed.data.groupByType });
        }

        // 分值设置与配图/留白设置互斥，先按分值 schema 尝试解析
        const scoreParsed = updateScoreSchema.safeParse(body);
        if (scoreParsed.success) {
            const paper = await prisma.examPaper.findUnique({ where: { id }, select: { userId: true } });
            if (!paper || paper.userId !== user.id) {
                return notFound("Exam paper not found");
            }

            const { score, questionId } = scoreParsed.data;
            const data = { score: normalizeExamScore(score) };
            if (questionId) {
                const { count } = await prisma.examQuestion.updateMany({
                    where: { id: questionId, paperId: id },
                    data,
                });
                if (count === 0) {
                    return notFound("Exam question not found");
                }
                return NextResponse.json({ questionId, score: data.score });
            }

            await prisma.examQuestion.updateMany({
                where: { paperId: id },
                data,
            });
            return NextResponse.json({ score: data.score });
        }

        const parsed = updateFigureSchema.safeParse(body);
        if (!parsed.success) {
            return validationError("Invalid exam paper update", parsed.error.issues);
        }

        const paper = await prisma.examPaper.findUnique({ where: { id }, select: { userId: true } });
        if (!paper || paper.userId !== user.id) {
            return notFound("Exam paper not found");
        }

        const { figureScale, figureAlign, answerSpacePx, questionId } = parsed.data;
        const data: { figureScale?: number; figureAlign?: FigureAlign; answerSpacePx?: number | null } = {};
        if (figureScale !== undefined) data.figureScale = figureScale;
        if (figureAlign !== undefined) data.figureAlign = figureAlign;
        if (answerSpacePx !== undefined) data.answerSpacePx = answerSpacePx;

        if (questionId) {
            const { count } = await prisma.examQuestion.updateMany({
                where: { id: questionId, paperId: id },
                data,
            });
            if (count === 0) {
                return notFound("Exam question not found");
            }
            return NextResponse.json({ questionId, ...data });
        }

        await prisma.examQuestion.updateMany({
            where: { paperId: id },
            data,
        });
        return NextResponse.json(data);
    } catch (error) {
        logger.error({ error }, 'Error updating exam paper');
        return internalError("Failed to update exam paper");
    }
});

export const PUT = PATCH;

/**
 * DELETE /api/exams/:id
 * 删除试卷；已录入的举一反三记录保留在原题历史中
 */
export const DELETE = withUser(async (
    _req: Request,
    { user, params }: AuthenticatedContext & { params: Promise<{ id: string }> }
) => {
    const { id } = await params;

    try {
        const paper = await prisma.examPaper.findUnique({ where: { id }, select: { userId: true } });
        if (!paper || paper.userId !== user.id) {
            return notFound("Exam paper not found");
        }

        await prisma.examPaper.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error({ error }, 'Error deleting exam paper');
        return internalError("Failed to delete exam paper");
    }
});

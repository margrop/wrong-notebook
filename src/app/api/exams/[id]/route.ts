import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, validationError, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { generateExamPaper, isPaperGenerating } from "@/lib/exam";
import { FIGURE_ALIGNS, MAX_FIGURE_SCALE, MIN_FIGURE_SCALE, normalizeFigureAlign, normalizeFigureScale } from "@/lib/figure-scale";
import type { FigureAlign } from "@/lib/figure-scale";

const logger = createLogger('api:exams:id');

const updateFigureSchema = z.object({
    figureScale: z.number().int().min(MIN_FIGURE_SCALE).max(MAX_FIGURE_SCALE).optional(),
    figureAlign: z.enum(FIGURE_ALIGNS).optional(),
    questionId: z.string().min(1).optional(),
}).refine((data) => data.figureScale !== undefined || data.figureAlign !== undefined, {
    message: "figureScale or figureAlign is required",
});

/**
 * GET /api/exams/:id
 * 试卷详情，含每题内容、来源短 ID 与历次录入的结果
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const paper = await prisma.examPaper.findUnique({
            where: { id },
            include: {
                questions: {
                    orderBy: { order: 'asc' },
                    include: {
                        errorItem: { select: { id: true, subject: { select: { name: true } } } },
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
                notebookName: errorItem?.subject?.name ?? null,
                attempts: practiceRecords,
            })),
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching exam paper');
        return internalError("Failed to fetch exam paper");
    }
}

/**
 * PATCH /api/exams/:id
 * 保存试卷配图显示与打印比例、位置：指定 questionId 时只改单题，未指定时统一修改本卷全部题目
 */
export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const parsed = updateFigureSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) {
            return validationError("Invalid figure settings", parsed.error.issues);
        }

        const paper = await prisma.examPaper.findUnique({ where: { id }, select: { userId: true } });
        if (!paper || paper.userId !== user.id) {
            return notFound("Exam paper not found");
        }

        const { figureScale, figureAlign, questionId } = parsed.data;
        const data: { figureScale?: number; figureAlign?: FigureAlign } = {};
        if (figureScale !== undefined) data.figureScale = figureScale;
        if (figureAlign !== undefined) data.figureAlign = figureAlign;

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
        logger.error({ error }, 'Error updating exam figure scale');
        return internalError("Failed to update exam figure scale");
    }
}

export const PUT = PATCH;

/**
 * DELETE /api/exams/:id
 * 删除试卷；已录入的举一反三记录保留在原题历史中
 */
export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

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
}

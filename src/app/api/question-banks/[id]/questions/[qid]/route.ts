import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { internalError, notFound, validationError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { saveQuestion } from "@/lib/question/question-save";
import { SUBJECT_DISPLAY_NAMES, isNotebookSubject } from "@/lib/notebook-scope";
import { normalizeQuestionType } from "@/lib/question/question-type";
import { bankQuestionGradeSemester, composeBankQuestionText } from "@/lib/question-bank/import";

const logger = createLogger('api:question-banks:question');

type RouteContext = { params: Promise<{ id: string; qid: string }> };

import { DEFAULT_FIGURE_ALIGN, DEFAULT_FIGURE_SCALE } from "@/lib/figure-scale";
const updateQuestionSchema = z.object({
    text: z.string().trim().min(1).max(20000).optional(),
    answer: z.string().trim().max(20000).nullable().optional(),
    analysis: z.string().trim().max(50000).nullable().optional(),
    knowledgePoints: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    difficultyStars: z.number().int().min(1).max(5).nullable().optional(),
    questionType: z.string().trim().max(200).nullable().optional(),
});

/** PATCH /api/question-banks/:id/questions/:qid：编辑题库题目 */
export const PATCH = withUser(async (req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id, qid } = await params;
    const parsed = updateQuestionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError('Invalid question update', parsed.error.issues);
    try {
        const question = await prisma.bankQuestion.findFirst({
            where: { id: qid, bank: { id, userId: user.id } },
            select: { id: true },
        });
        if (!question) return notFound('Question not found');
        const data = parsed.data;
        const updated = await prisma.bankQuestion.update({
            where: { id: qid },
            data: {
                ...(data.text ? { text: data.text } : {}),
                ...(data.answer !== undefined ? { answer: data.answer?.trim() || null } : {}),
                ...(data.analysis !== undefined ? { analysis: data.analysis?.trim() || null } : {}),
                ...(data.knowledgePoints ? { knowledgePoints: JSON.stringify(data.knowledgePoints) } : {}),
                ...(data.difficultyStars !== undefined ? { difficultyStars: data.difficultyStars } : {}),
                ...(data.questionType !== undefined ? { questionType: normalizeQuestionType(data.questionType) } : {}),
            },
        });
        return NextResponse.json({ question: { id: updated.id } });
    } catch (error) {
        logger.error({ error }, 'Failed to update bank question');
        return internalError('Failed to update bank question');
    }
});

/** DELETE /api/question-banks/:id/questions/:qid */
export const DELETE = withUser(async (_req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id, qid } = await params;
    try {
        const question = await prisma.bankQuestion.findFirst({
            where: { id: qid, bank: { id, userId: user.id } },
            select: { id: true },
        });
        if (!question) return notFound('Question not found');
        await prisma.$transaction([
            prisma.bankQuestion.delete({ where: { id: qid } }),
            prisma.questionBank.update({
                where: { id },
                data: { questionCount: { decrement: 1 } },
            }),
        ]);
        return NextResponse.json({ ok: true });
    } catch (error) {
        logger.error({ error }, 'Failed to delete bank question');
        return internalError('Failed to delete bank question');
    }
});

/** POST /api/question-banks/:id/questions/:qid：把单题写入错题本 */
export const POST = withUser(async (req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id, qid } = await params;
    const body = await req.json().catch(() => ({})) as { notebookId?: unknown };
    const notebookId = typeof body.notebookId === 'string' && body.notebookId.trim() ? body.notebookId.trim() : null;
    try {
        const question = await prisma.bankQuestion.findFirst({
            where: { id: qid, bank: { id, userId: user.id } },
        });
        if (!question) return notFound('Question not found');
        if (notebookId) {
            const notebook = await prisma.subject.findFirst({ where: { id: notebookId, userId: user.id }, select: { id: true } });
            if (!notebook) return notFound('Notebook not found');
        }
        const subjectKey = isNotebookSubject(question.subjectKey) ? question.subjectKey : null;
        const saved = await saveQuestion(user, {
            questionText: composeBankQuestionText(question),
            answerText: question.answer ?? "",
            analysis: question.analysis ?? "",
            knowledgePoints: (() => {
                try {
                    const parsed: unknown = JSON.parse(question.knowledgePoints || '[]');
                    return Array.isArray(parsed) ? parsed.filter((point): point is string => typeof point === 'string') : [];
                } catch {
                    return [];
                }
            })(),
            difficultyStars: question.difficultyStars ?? undefined,
            figureScale: DEFAULT_FIGURE_SCALE,
            figureAlign: DEFAULT_FIGURE_ALIGN,
            gradeSemester: bankQuestionGradeSemester(question) ?? undefined,
            questionType: question.questionType ?? undefined,
            source: question.source ?? undefined,
            figureSvg: question.figureSvg ?? undefined,
            originalImageUrl: '',
            subjectId: notebookId ?? undefined,
            subjectName: notebookId || !subjectKey ? undefined : SUBJECT_DISPLAY_NAMES[subjectKey],
            mistakeStatus: 'unknown',
        }, { origin: 'manual' });
        if (!saved.ok) {
            return NextResponse.json({ ok: false, code: saved.error.code }, { status: saved.error.status });
        }
        return NextResponse.json({ ok: true, duplicate: saved.status === 'duplicate', errorItemId: saved.item.id });
    } catch (error) {
        logger.error({ error }, 'Failed to add bank question to error items');
        return internalError('Failed to add bank question to error items');
    }
});

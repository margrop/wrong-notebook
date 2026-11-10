import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { conflict, internalError, notFound, validationError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import type { BankQuestionRow, QuestionBankDetail, QuestionBankSummary } from "@/lib/question-bank/types";

const logger = createLogger('api:question-banks:id');

type RouteContext = { params: Promise<{ id: string }> };

const updateBankSchema = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
});

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function toSummary(bank: {
    id: string; name: string; description: string | null; stage: string; subjectKey: string | null;
    gradeRange: string | null; source: string | null; sourceUrl: string | null; license: string | null;
    questionCount: number; createdAt: Date; updatedAt: Date;
}): QuestionBankSummary {
    return {
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
    };
}

/** GET /api/question-banks/:id：题库详情，题目按关键词、年级、知识点分页 */
export const GET = withUser(async (req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;
    try {
        const bank = await prisma.questionBank.findFirst({ where: { id, userId: user.id } });
        if (!bank) return notFound('Bank not found');

        const { searchParams } = new URL(req.url);
        const q = searchParams.get('q')?.trim() ?? '';
        const gradeParam = searchParams.get('grade');
        const grade = gradeParam ? Number.parseInt(gradeParam, 10) : null;
        const tag = searchParams.get('tag')?.trim() ?? '';
        const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
        const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));

        const where = {
            bankId: bank.id,
            ...(Number.isInteger(grade) ? { grade } : {}),
            ...(q ? { OR: [{ text: { contains: q } }, { source: { contains: q } }, { externalId: { contains: q } }] } : {}),
            ...(tag ? { knowledgePoints: { contains: tag } } : {}),
        };
        const [total, questions] = await Promise.all([
            prisma.bankQuestion.count({ where }),
            prisma.bankQuestion.findMany({
                where,
                orderBy: { createdAt: 'asc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: {
                    id: true, externalId: true, stage: true, subjectKey: true, grade: true, semester: true,
                    questionType: true, difficultyStars: true, text: true, optionsJson: true, answer: true,
                    analysis: true, knowledgePoints: true, source: true, figureSvg: true,
                },
            }),
        ]);
        const rows: BankQuestionRow[] = questions.map((question) => ({
            ...question,
            knowledgePoints: (() => {
                try {
                    const parsed: unknown = JSON.parse(question.knowledgePoints || '[]');
                    return Array.isArray(parsed) ? parsed.filter((point): point is string => typeof point === 'string') : [];
                } catch {
                    return [];
                }
            })(),
        }));
        const detail: QuestionBankDetail = {
            ...toSummary(bank),
            questions: rows,
            total,
            page,
            pageSize,
        };
        return NextResponse.json(detail);
    } catch (error) {
        logger.error({ error }, 'Failed to read question bank');
        return internalError('Failed to read question bank');
    }
});

/** PATCH /api/question-banks/:id：重命名或修改说明 */
export const PATCH = withUser(async (req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;
    const parsed = updateBankSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError('Invalid bank update', parsed.error.issues);
    try {
        const bank = await prisma.questionBank.findFirst({ where: { id, userId: user.id } });
        if (!bank) return notFound('Bank not found');
        const name = parsed.data.name;
        if (name && name !== bank.name) {
            const existing = await prisma.questionBank.findFirst({ where: { userId: user.id, name }, select: { id: true } });
            if (existing) return conflict('BANK_NAME_EXISTS');
        }
        const updated = await prisma.questionBank.update({
            where: { id },
            data: {
                ...(name ? { name } : {}),
                ...(parsed.data.description !== undefined ? { description: parsed.data.description?.trim() || null } : {}),
            },
        });
        return NextResponse.json(toSummary(updated));
    } catch (error) {
        logger.error({ error }, 'Failed to update question bank');
        return internalError('Failed to update question bank');
    }
});

/** DELETE /api/question-banks/:id：删除题库与全部题目（题目已写入的错题不受影响） */
export const DELETE = withUser(async (_req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;
    try {
        const bank = await prisma.questionBank.findFirst({ where: { id, userId: user.id }, select: { id: true } });
        if (!bank) return notFound('Bank not found');
        await prisma.questionBank.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (error) {
        logger.error({ error }, 'Failed to delete question bank');
        return internalError('Failed to delete question bank');
    }
});

export const dynamic = 'force-dynamic';

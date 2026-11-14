import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { internalError, validationError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:practice:questions');

const PAGE_SIZE = 20;

const querySchema = z.object({
    notebookId: z.string().min(1).optional(),
    tag: z.string().trim().min(1).max(100).optional(),
    difficulty: z.enum(['easy', 'medium', 'hard', 'harder']).optional(),
    // attempted：至少作答过一次；unattempted：还没有作答
    status: z.enum(['attempted', 'unattempted']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(PAGE_SIZE),
});

/** GET /api/practice/questions：当前用户已生成的智能练习历史题，可按错题本、知识点、难度与作答状态筛选 */
export const GET = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    try {
        const params = new URL(req.url).searchParams;
        const parsed = querySchema.safeParse(Object.fromEntries(params));
        if (!parsed.success) {
            return validationError("Invalid practice question filters", parsed.error.issues);
        }
        const { notebookId, tag, difficulty, status, page, pageSize } = parsed.data;

        const where = {
            userId: user.id,
            ...(difficulty ? { difficulty } : {}),
            ...(status === 'attempted' ? { attempts: { some: {} } } : {}),
            ...(status === 'unattempted' ? { attempts: { none: {} } } : {}),
            ...(notebookId || tag ? {
                errorItem: {
                    ...(notebookId ? { subjectId: notebookId } : {}),
                    ...(tag ? { tags: { some: { name: tag } } } : {}),
                },
            } : {}),
        };

        const [total, questions] = await Promise.all([
            prisma.practiceQuestion.count({ where }),
            prisma.practiceQuestion.findMany({
                where,
                orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: {
                    id: true,
                    questionText: true,
                    difficulty: true,
                    source: true,
                    generatedAt: true,
                    createdAt: true,
                    errorItem: {
                        select: {
                            id: true,
                            shortId: true,
                            seqNo: true,
                            questionText: true,
                            subject: { select: { id: true, name: true } },
                        },
                    },
                    attempts: {
                        select: { id: true, result: true, isCorrect: true, createdAt: true },
                        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                        take: 1,
                    },
                    _count: { select: { attempts: true } },
                },
            }),
        ]);

        return NextResponse.json({
            page,
            pageSize,
            total,
            hasMore: page * pageSize < total,
            items: questions.map(({ attempts, _count, ...question }) => ({
                ...question,
                attemptCount: _count.attempts,
                lastAttempt: attempts[0] ?? null,
            })),
        });
    } catch (error) {
        logger.error({ error }, 'Error listing practice questions');
        return internalError("Failed to list practice questions", { error, scope: "api:practice:questions" });
    }
});

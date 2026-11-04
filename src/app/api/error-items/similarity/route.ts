import { NextResponse } from 'next/server';
import { z } from 'zod';
import { badRequest, internalError, notFound, validationError } from '@/lib/api-errors';
import { withUser } from '@/lib/api-handler';
import type { AuthenticatedContext } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { calculateQuestionSimilarity, DEFAULT_QUESTION_DUPLICATE_THRESHOLD, duplicateQuestionSimilarity } from '@/lib/question/question-similarity';

const logger = createLogger('api:error-items:similarity');
const schema = z.object({ ids: z.tuple([z.string().min(1).max(200), z.string().min(1).max(200)]) })
    .refine(({ ids }) => ids[0] !== ids[1], { message: 'Select two different questions' });

/** 只比较当前用户的两道题，使用与自动导入相同的相似度定义，不写入练习记录。 */
export const POST = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    try {
        const parsed = schema.safeParse(await req.json());
        if (!parsed.success) return validationError('Invalid question selection', parsed.error.issues);
        const items = await prisma.errorItem.findMany({
            where: { userId: user.id, id: { in: parsed.data.ids } },
            select: { id: true, shortId: true, questionText: true, ocrText: true, subject: { select: { name: true } } },
        });
        if (items.length !== 2) return notFound('Item not found');
        const ordered = parsed.data.ids.map((id) => items.find((item) => item.id === id)!);
        const texts = ordered.map((item) => item.questionText?.trim() || item.ocrText?.trim() || '');
        const similarity = calculateQuestionSimilarity(texts[0], texts[1]);
        if (similarity === null) return badRequest('Question text is required for similarity comparison');
        const threshold = user.questionDuplicateThreshold ?? DEFAULT_QUESTION_DUPLICATE_THRESHOLD;
        return NextResponse.json({
            similarity,
            threshold,
            duplicate: duplicateQuestionSimilarity(texts[0], texts[1], threshold) !== null,
            items: ordered.map((item, index) => ({ id: item.id, shortId: item.shortId, questionText: texts[index], notebookName: item.subject?.name ?? null })),
        });
    } catch (error) {
        logger.error({ error }, '相似度比较失败');
        return internalError('Failed to compare questions');
    }
});

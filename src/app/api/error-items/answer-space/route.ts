import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validationError, internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { PRINT_PREVIEW_PAGE_SIZE } from "@/lib/constants/pagination";
import { MAX_CUSTOM_ANSWER_SPACE_PX, MIN_CUSTOM_ANSWER_SPACE_PX } from "@/lib/exam/exam-answer-space";

const logger = createLogger('api:error-items:answer-space');

const answerSpaceSchema = z.object({
    items: z.array(z.object({
        id: z.string().min(1),
        // null 表示清除手动值，恢复按全局留白档位
        answerSpacePx: z.number().int().min(MIN_CUSTOM_ANSWER_SPACE_PX).max(MAX_CUSTOM_ANSWER_SPACE_PX).nullable(),
    })).min(1).max(PRINT_PREVIEW_PAGE_SIZE),
});

/**
 * PUT /api/error-items/answer-space
 * 批量保存错题打印时手动调整的题下留白高度；只更新当前用户自己的错题
 */
export const PUT = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    try {
        const parsed = answerSpaceSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) {
            return validationError("Invalid answer space settings", parsed.error.issues);
        }

        // 相同取值合并为一次 updateMany，清除全部手动值时只需一条语句
        const idsByValue = new Map<number | null, string[]>();
        for (const { id, answerSpacePx } of parsed.data.items) {
            idsByValue.set(answerSpacePx, [...(idsByValue.get(answerSpacePx) ?? []), id]);
        }
        const results = await prisma.$transaction(
            Array.from(idsByValue, ([answerSpacePx, ids]) => prisma.errorItem.updateMany({
                where: { id: { in: ids }, userId: user.id },
                data: { answerSpacePx },
            })),
        );

        return NextResponse.json({ updated: results.reduce((sum, result) => sum + result.count, 0) });
    } catch (error) {
        logger.error({ error }, 'Error saving answer space');
        return internalError("Failed to save answer space");
    }
});

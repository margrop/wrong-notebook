import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { scheduleMasteryEvaluation } from "@/lib/mastery";

const logger = createLogger('api:practice:record:id');

type RouteContext = { params: Promise<{ id: string }> };

/**
 * DELETE /api/practice/record/:id
 * 删除一条举一反三记录（用于更正录错的结果），并重新评估原题掌握概率
 */
async function handleDelete(
    _req: Request,
    ctx: AuthenticatedContext & RouteContext
) {
    const { user } = ctx;
    const { id } = await ctx.params;

    const record = await prisma.practiceRecord.findUnique({ where: { id }, select: { userId: true, errorItemId: true } });
    if (!record || record.userId !== user.id) {
        return notFound("Practice record not found");
    }

    await prisma.practiceRecord.delete({ where: { id } });
    if (record.errorItemId) {
        scheduleMasteryEvaluation([record.errorItemId]);
    }

    return NextResponse.json({ success: true });
}

export const DELETE = withUser<RouteContext>(async (req, ctx) => {
    try {
        return await handleDelete(req, ctx);
    } catch (error) {
        logger.error({ error }, 'Error deleting practice record');
        return internalError("Failed to delete practice record", { error, scope: "api:practice" });
    }
});

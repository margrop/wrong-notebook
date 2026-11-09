import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { batchMoveSchema } from "@/lib/schemas/error-items";

const logger = createLogger('api:error-items:batch-move');

/**
 * POST /api/error-items/batch-move
 * 批量把错题移动到另一个错题本；知识点标签保持不变。
 * Body: { ids: string[], subjectId: string }
 */
export const POST = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    try {
        const parsed = batchMoveSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return badRequest("ids must be a non-empty array of at most 100 strings and subjectId is required");
        }
        const { ids, subjectId } = parsed.data;

        // 目标错题本必须属于当前用户，与单题修改的权限规则一致
        const targetNotebook = await prisma.subject.findUnique({ where: { id: subjectId } });
        if (!targetNotebook || targetNotebook.userId !== user.id) {
            return forbidden("Not authorized to move to this notebook");
        }

        const owned = await prisma.errorItem.findMany({
            where: { id: { in: ids }, userId: user.id },
            select: { id: true },
        });
        const ownedIds = owned.map((item) => item.id);
        const failed = ids.filter((id) => !ownedIds.includes(id));

        let movedCount = 0;
        if (ownedIds.length > 0) {
            const result = await prisma.errorItem.updateMany({
                where: { id: { in: ownedIds }, userId: user.id },
                data: { subjectId },
            });
            movedCount = result.count;
        }

        logger.info({ userId: user.id, subjectId, movedCount, failedCount: failed.length }, 'Batch move completed');
        return NextResponse.json({ moved: movedCount, failed });
    } catch (error) {
        logger.error({ error }, 'Error in batch move');
        return internalError("Failed to move items");
    }
});

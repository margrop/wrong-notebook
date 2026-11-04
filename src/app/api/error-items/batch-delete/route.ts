import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:error-items:batch-delete');

/**
 * POST /api/error-items/batch-delete
 * 批量删除错题
 * Body: { ids: string[] }
 */
export const POST = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    logger.info('POST /api/error-items/batch-delete called');

    try {
        const body = await req.json();
        const { ids } = body;

        // 验证参数
        if (!Array.isArray(ids) || ids.length === 0) {
            return badRequest("ids must be a non-empty array");
        }

        if (ids.length > 100) {
            return badRequest("Cannot delete more than 100 items at once");
        }

        logger.debug({ userId: user.id, idsCount: ids.length }, 'Batch delete request');

        // 查询所有要删除的错题，验证所有权
        const itemsToDelete = await prisma.errorItem.findMany({
            where: {
                id: { in: ids },
            },
            select: {
                id: true,
                userId: true,
            },
        });

        // 过滤出属于当前用户的错题
        const ownedIds = itemsToDelete
            .filter(item => item.userId === user.id)
            .map(item => item.id);

        const unauthorizedIds = ids.filter(id => !ownedIds.includes(id));

        if (unauthorizedIds.length > 0) {
            logger.warn({ unauthorizedIds }, 'Some items do not belong to user or do not exist');
        }

        // 执行删除
        let deletedCount = 0;
        if (ownedIds.length > 0) {
            const result = await prisma.errorItem.deleteMany({
                where: {
                    id: { in: ownedIds },
                },
            });
            deletedCount = result.count;
        }

        logger.info({ deletedCount, requestedCount: ids.length, failedCount: unauthorizedIds.length }, 'Batch delete completed');

        return NextResponse.json({
            deleted: deletedCount,
            failed: unauthorizedIds,
        });
    } catch (error) {
        logger.error({ error }, 'Error in batch delete');
        return internalError("Failed to delete items");
    }
});

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { isShortId } from "@/lib/short-id/short-id";

const logger = createLogger('api:error-items:short');

type RouteContext = { params: Promise<{ shortId: string }> };

/**
 * GET /api/error-items/short/:shortId
 * 按短 ID 定位当前用户的题目
 */
export const GET = withUser(async (_req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { shortId } = await params;

    try {
        if (!isShortId(shortId)) {
            return notFound("Item not found");
        }

        const item = await prisma.errorItem.findUnique({
            where: { shortId },
            select: { id: true, userId: true, subjectId: true, shortId: true },
        });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }

        return NextResponse.json({ id: item.id, subjectId: item.subjectId, shortId: item.shortId });
    } catch (error) {
        logger.error({ error }, 'Error locating item by short ID');
        return internalError("Failed to locate error item");
    }
});

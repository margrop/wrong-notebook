import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { isShortId } from "@/lib/short-id/short-id";
import { parseSeqNoQuery } from "@/lib/seq-no/seq-no";

const logger = createLogger('api:error-items:short');

type RouteContext = { params: Promise<{ shortId: string }> };

/**
 * GET /api/error-items/short/:shortId
 * 按 6 位 ID 或流水号定位当前用户的题目。纯数字的 6 位 ID 与流水号写法相同，先按流水号查，没有再按 ID 查
 */
export const GET = withUser(async (_req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { shortId } = await params;

    try {
        const seqNo = parseSeqNoQuery(shortId);
        if (!isShortId(shortId) && seqNo === null) {
            return notFound("Item not found");
        }

        const select = { id: true, userId: true, subjectId: true, shortId: true } as const;
        const bySeqNo = seqNo !== null
            ? await prisma.errorItem.findUnique({ where: { userId_seqNo: { userId: user.id, seqNo } }, select })
            : null;
        const item = bySeqNo ?? (isShortId(shortId) ? await prisma.errorItem.findUnique({ where: { shortId }, select }) : null);
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }

        return NextResponse.json({ id: item.id, subjectId: item.subjectId, shortId: item.shortId });
    } catch (error) {
        logger.error({ error }, 'Error locating item by short ID');
        return internalError("Failed to locate error item");
    }
});

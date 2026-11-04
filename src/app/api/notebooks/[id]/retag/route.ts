import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getRetagJob, startRetagJob } from "@/lib/tags/retag";
import { consumeAiQuota } from "@/lib/ai-quota";

const logger = createLogger('api:notebooks:retag');

type RouteContext = { params: Promise<{ id: string }> };

async function findOwnNotebook(id: string, userId: string) {
    const notebook = await prisma.subject.findUnique({ where: { id }, select: { userId: true } });
    return notebook?.userId === userId;
}

/**
 * GET /api/notebooks/:id/retag
 * 查询错题本批量重新生成知识点的进度
 */
async function handleGet(
    _req: Request,
    ctx: AuthenticatedContext & RouteContext
) {
    const { user } = ctx;
    const { id } = await ctx.params;

    if (!(await findOwnNotebook(id, user.id))) {
        return notFound("Notebook not found");
    }
    return NextResponse.json(getRetagJob(user.id, id));
}

export const GET = withUser<RouteContext>(async (req, ctx) => {
    try {
        return await handleGet(req, ctx);
    } catch (error) {
        logger.error({ error }, 'Error fetching retag job');
        return internalError("Failed to fetch retag status");
    }
});

/**
 * POST /api/notebooks/:id/retag
 * 在后台为错题本中的全部题目重新生成知识点
 */
async function handlePost(
    _req: Request,
    ctx: AuthenticatedContext & RouteContext
) {
    const { user } = ctx;
    const { id } = await ctx.params;

    if (!(await findOwnNotebook(id, user.id))) {
        return notFound("Notebook not found");
    }
    const limited = await consumeAiQuota(user, 'retag');
    if (limited) return limited;

    return NextResponse.json(await startRetagJob(user.id, id), { status: 202 });
}

export const POST = withUser<RouteContext>(async (req, ctx) => {
    try {
        return await handlePost(req, ctx);
    } catch (error) {
        logger.error({ error }, 'Error starting retag job');
        return internalError("Failed to start retag job");
    }
});

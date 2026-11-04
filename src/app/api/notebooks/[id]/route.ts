import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { forbidden, notFound, badRequest, internalError } from "@/lib/api-errors";
import { updateNotebookSchema } from "@/lib/schemas/notebooks";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:notebooks:id');

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/notebooks/[id]
 * 获取单个错题本详情
 */
async function handleGet(
    _req: Request,
    ctx: AuthenticatedContext & RouteContext
) {
    const { user } = ctx;
    const { id } = await ctx.params;

    const notebook = await prisma.subject.findUnique({
        where: { id },
        include: {
            _count: {
                select: {
                    errorItems: true,
                },
            },
        },
    });

    if (!notebook) {
        return notFound("Notebook not found");
    }

    if (notebook.userId !== user.id) {
        return forbidden("Not authorized to access this notebook");
    }

    return NextResponse.json(notebook);
}

export const GET = withUser<RouteContext>(async (req, ctx) => {
    try {
        return await handleGet(req, ctx);
    } catch (error) {
        logger.error({ error }, 'Error fetching notebook');
        return internalError("Failed to fetch notebook");
    }
});

/**
 * PUT /api/notebooks/[id]
 * 更新错题本信息
 */
async function handlePut(
    req: Request,
    ctx: AuthenticatedContext & RouteContext
) {
    const { user } = ctx;
    const { id } = await ctx.params;

    const notebook = await prisma.subject.findUnique({
        where: { id },
    });

    if (!notebook) {
        return notFound("Notebook not found");
    }

    if (notebook.userId !== user.id) {
        return forbidden("Not authorized to update this notebook");
    }

    const parsed = updateNotebookSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return badRequest("Notebook name is required");
    }
    const { name } = parsed.data;

    const updated = await prisma.subject.update({
        where: { id },
        data: {
            name: name.trim(),
        },
        include: {
            _count: {
                select: {
                    errorItems: true,
                },
            },
        },
    });

    return NextResponse.json(updated);
}

export const PUT = withUser<RouteContext>(async (req, ctx) => {
    try {
        return await handlePut(req, ctx);
    } catch (error) {
        logger.error({ error }, 'Error updating notebook');
        return internalError("Failed to update notebook");
    }
});

/**
 * DELETE /api/notebooks/[id]
 * 删除错题本
 */
async function handleDelete(
    _req: Request,
    ctx: AuthenticatedContext & RouteContext
) {
    const { user } = ctx;
    const { id } = await ctx.params;

    const notebook = await prisma.subject.findUnique({
        where: { id },
        include: {
            _count: {
                select: {
                    errorItems: true,
                },
            },
        },
    });

    if (!notebook) {
        return notFound("Notebook not found");
    }

    if (notebook.userId !== user.id) {
        return forbidden("Not authorized to delete this notebook");
    }

    // 检查是否有错题
    if (notebook._count.errorItems > 0) {
        return badRequest("Cannot delete notebook with error items. Please move or delete all items first.");
    }

    await prisma.subject.delete({
        where: { id },
    });

    return NextResponse.json({ message: "Notebook deleted successfully" });
}

export const DELETE = withUser<RouteContext>(async (req, ctx) => {
    try {
        return await handleDelete(req, ctx);
    } catch (error) {
        logger.error({ error }, 'Error deleting notebook');
        return internalError("Failed to delete notebook");
    }
});

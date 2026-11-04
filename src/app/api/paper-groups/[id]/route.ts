import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { notFound, badRequest, validationError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:paper-groups:id');

const updateSchema = z.object({
    name: z.string().trim().min(1).max(30).optional(),
    order: z.number().int().optional(),
    isActive: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

async function handlePatch(
    req: Request,
    ctx: AuthenticatedContext & RouteContext
) {
    const { user } = ctx;
    const { id } = await ctx.params;

    const group = await prisma.paperGroup.findUnique({ where: { id } });
    if (!group || group.userId !== user.id) return notFound("Group not found");

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return validationError("Invalid request", parsed.error.issues);

    const { name, order, isActive } = parsed.data;

    if (name && name !== group.name) {
        const dup = await prisma.paperGroup.findFirst({
            where: { userId: user.id, name, id: { not: id } },
        });
        if (dup) {
            return validationError("Group name already exists", [{ code: "duplicate_name", path: ["name"], message: "Group name already exists" }]);
        }
    }

    const updated = await prisma.paperGroup.update({
        where: { id },
        data: {
            ...(name !== undefined ? { name } : {}),
            ...(order !== undefined ? { order } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
        },
    });

    return NextResponse.json(updated);
}

export const PATCH = withUser<RouteContext>(handlePatch);

async function handleDelete(
    req: Request,
    ctx: AuthenticatedContext & RouteContext
) {
    const { user } = ctx;
    const { id } = await ctx.params;

    const group = await prisma.paperGroup.findUnique({ where: { id } });
    if (!group || group.userId !== user.id) return notFound("Group not found");

    // 系统默认分组（key='a'/'b'/'other'）不允许删除
    if (group.key) {
        return badRequest("System default groups cannot be deleted");
    }

    const errorItemCount = await prisma.errorItem.count({ where: { paperLevel: id } });

    if (errorItemCount > 0) {
        const { searchParams } = new URL(req.url);
        const clear = searchParams.get("clear") === "true";
        const migrateTo = searchParams.get("migrateTo");

        if (clear) {
            await prisma.errorItem.updateMany({ where: { paperLevel: id }, data: { paperLevel: null } });
        } else if (migrateTo) {
            const target = await prisma.paperGroup.findFirst({
                where: { id: migrateTo, userId: user.id, isActive: true },
            });
            if (!target) return badRequest("Invalid migrateTo group");
            await prisma.errorItem.updateMany({ where: { paperLevel: id }, data: { paperLevel: migrateTo } });
        } else {
            return NextResponse.json({ error: "Group has error items", errorItemCount }, { status: 409 });
        }
    }

    await prisma.paperGroup.delete({ where: { id } });
    logger.info({ groupId: id, userId: user.id }, 'Paper group deleted');

    return NextResponse.json({ ok: true });
}

export const DELETE = withUser<RouteContext>(handleDelete);

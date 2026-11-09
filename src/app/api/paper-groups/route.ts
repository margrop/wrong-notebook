import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { validationError } from "@/lib/api-errors";
import { serializeWrite } from "@/lib/db-write-queue";

const createSchema = z.object({
    name: z.string().trim().min(1).max(30),
    order: z.number().int().optional(),
});

async function handleGet(_req: Request, { user }: AuthenticatedContext) {
    const groups = await prisma.paperGroup.findMany({
        where: { userId: user.id },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: { _count: { select: { errorItems: true } } },
    });

    return NextResponse.json(groups);
}

export const GET = withUser(handleGet);

async function handlePost(req: Request, { user }: AuthenticatedContext) {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return validationError("Invalid request", parsed.error.issues);

    const { name, order } = parsed.data;

    const existing = await prisma.paperGroup.findFirst({
        where: { userId: user.id, name },
    });
    if (existing) {
        return validationError("Group name already exists", [{ code: "duplicate_name", path: ["name"], message: "Group name already exists" }]);
    }

    const maxOrder = await prisma.paperGroup.aggregate({
        where: { userId: user.id },
        _max: { order: true },
    });

    try {
        const group = await serializeWrite(() => prisma.paperGroup.create({
            data: {
                userId: user.id,
                name,
                order: order ?? (maxOrder._max.order ?? -1) + 1,
            },
        }));
        return NextResponse.json(group, { status: 201 });
    } catch (error) {
        // 并发创建同名分组时先查后建的窗口内会撞唯一约束，按业务错误返回而不是 500
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code === "P2002") {
            return validationError("Group name already exists", [{ code: "duplicate_name", path: ["name"], message: "Group name already exists" }]);
        }
        throw error;
    }
}

export const POST = withUser(handlePost);

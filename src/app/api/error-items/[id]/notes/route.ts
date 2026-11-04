import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, badRequest, internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:error-items:notes');

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withUser(async (req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;

    try {
        const { userNotes } = await req.json();
        if (userNotes !== null && typeof userNotes !== 'string') {
            return badRequest("userNotes must be a string");
        }

        const existing = await prisma.errorItem.findUnique({ where: { id }, select: { userId: true } });
        if (!existing || existing.userId !== user.id) {
            return notFound("Item not found");
        }

        const errorItem = await prisma.errorItem.update({
            where: {
                id: id,
            },
            data: {
                userNotes: userNotes,
            },
        });

        return NextResponse.json(errorItem);
    } catch (error) {
        logger.error({ error }, 'Error updating notes');
        return internalError("Failed to update notes");
    }
});

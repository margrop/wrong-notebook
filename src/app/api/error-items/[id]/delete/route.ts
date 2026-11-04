import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forbidden, notFound, internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:error-items:delete');

type RouteContext = { params: Promise<{ id: string }> };

export const DELETE = withUser(async (_req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;

    try {
        // Verify ownership before deletion
        const errorItem = await prisma.errorItem.findUnique({
            where: { id: id },
        });

        if (!errorItem) {
            return notFound("Item not found");
        }

        if (errorItem.userId !== user.id) {
            return forbidden("Not authorized to delete this item");
        }

        // Delete the item
        await prisma.errorItem.delete({
            where: { id: id },
        });

        return NextResponse.json({ message: "Deleted successfully" });
    } catch (error) {
        logger.error({ error }, 'Error deleting item');
        return internalError("Failed to delete error item");
    }
});

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:error-items:clear');

export const DELETE = withUser(async (_req: Request, { user }: AuthenticatedContext) => {
    try {
        // Delete all error items for this user
        await prisma.errorItem.deleteMany({
            where: { userId: user.id }
        });

        return NextResponse.json({ message: "Error data cleared successfully" });
    } catch (error) {
        logger.error({ error }, 'Error clearing error data');
        return internalError("Failed to clear error data");
    }
});

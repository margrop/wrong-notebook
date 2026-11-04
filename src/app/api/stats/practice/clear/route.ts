import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:stats:practice:clear');

export const DELETE = withUser(async (_req: Request, { user }: AuthenticatedContext) => {
    const userId = user.id;

    try {
        const result = await prisma.practiceRecord.deleteMany({
            where: { userId },
        });

        return NextResponse.json({
            message: "Practice history cleared successfully",
            count: result.count
        });
    } catch (error) {
        logger.error({ error }, 'Error clearing practice stats');
        return internalError("Failed to clear stats");
    }
});

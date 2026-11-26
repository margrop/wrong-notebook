import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { internalError, validationError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { batchUpdateSchema } from "@/lib/schemas/error-items";

const logger = createLogger('api:error-items:batch-update');

/**
 * POST /api/error-items/batch-update
 * 批量修改错题来源与年级学期；只更新请求中出现的字段，未出现的字段保持原值。
 * Body: { ids: string[], source?: string | null, gradeSemester?: string | null }
 */
export const POST = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    try {
        const parsed = batchUpdateSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return validationError("ids must be a non-empty array of at most 100 strings, and source or gradeSemester is required", parsed.error.issues);
        }
        const { ids, source, gradeSemester } = parsed.data;

        const owned = await prisma.errorItem.findMany({
            where: { id: { in: ids }, userId: user.id },
            select: { id: true },
        });
        const ownedIds = owned.map((item) => item.id);
        const failed = ids.filter((id) => !ownedIds.includes(id));

        const data: Prisma.ErrorItemUncheckedUpdateInput = {};
        if (source !== undefined) data.source = source?.trim() || null;
        if (gradeSemester !== undefined) data.gradeSemester = gradeSemester?.trim() || null;

        let updated = 0;
        if (ownedIds.length > 0) {
            updated = (await prisma.errorItem.updateMany({
                where: { id: { in: ownedIds }, userId: user.id },
                data,
            })).count;
        }

        logger.info({ userId: user.id, updated, failedCount: failed.length, fields: Object.keys(data) }, 'Batch update completed');
        return NextResponse.json({ updated, failed });
    } catch (error) {
        logger.error({ error }, 'Error in batch update');
        return internalError("Failed to update items");
    }
});

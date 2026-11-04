import { NextResponse } from "next/server";
import { notFound } from "@/lib/api-errors";
import { markImportBatchRead } from "@/lib/import/import-batches";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

/** POST /api/import-batches/:id/read 标记已查看 */
export const POST = withUser(async (_req: Request, { user, params }: { params: Promise<{ id: string }> } & AuthenticatedContext) => {
    const { id } = await params;
    if (!await markImportBatchRead(user, id)) return notFound("IMPORT_BATCH_NOT_FOUND");
    return NextResponse.json({ success: true });
});

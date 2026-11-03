import { NextResponse } from "next/server";
import { notFound, unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { markImportBatchRead } from "@/lib/import-batches";

/** POST /api/import-batches/:id/read 标记已查看 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    if (!await markImportBatchRead(user, id)) return notFound("IMPORT_BATCH_NOT_FOUND");
    return NextResponse.json({ success: true });
}

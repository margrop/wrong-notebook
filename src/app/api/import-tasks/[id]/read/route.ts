import { NextResponse } from "next/server";
import { notFound, unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { markImportTaskRead } from "@/lib/import-tasks";

/** POST /api/import-tasks/:id/read 标记已查看，清除未读提示 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    if (!await markImportTaskRead(user, id)) return notFound("IMPORT_TASK_NOT_FOUND");
    return NextResponse.json({ success: true });
}

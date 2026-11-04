import { NextResponse } from "next/server";
import { notFound } from "@/lib/api-errors";
import { markImportTaskRead } from "@/lib/import/import-tasks";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

/** POST /api/import-tasks/:id/read 标记已查看，清除未读提示 */
export const POST = withUser(async (_req: Request, { user, params }: { params: Promise<{ id: string }> } & AuthenticatedContext) => {
    const { id } = await params;
    if (!await markImportTaskRead(user, id)) return notFound("IMPORT_TASK_NOT_FOUND");
    return NextResponse.json({ success: true });
});

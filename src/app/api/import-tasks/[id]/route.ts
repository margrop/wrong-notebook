import { NextResponse } from "next/server";
import { notFound, unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { discardImportTask, getImportTask } from "@/lib/import-tasks";

type Params = { params: Promise<{ id: string }> };

/** GET /api/import-tasks/:id 任务详情（含待校对结果与图片），只能读取自己的任务 */
export async function GET(_req: Request, { params }: Params) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    const task = await getImportTask(user, id);
    if (!task) return notFound("IMPORT_TASK_NOT_FOUND");
    return NextResponse.json({ task });
}

/** DELETE /api/import-tasks/:id 丢弃任务（保存中的任务不可丢弃） */
export async function DELETE(_req: Request, { params }: Params) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    return discardImportTask(user, id);
}

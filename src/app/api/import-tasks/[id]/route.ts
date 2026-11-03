import { NextResponse } from "next/server";
import { notFound, unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { discardImportTask, getImportTask } from "@/lib/import-tasks";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/import-tasks/:id 任务状态与识别结果，只能读取自己的任务。
 * 默认不含题目图片（状态轮询使用）；?include=image 时附带图片，供校对页加载一次。
 */
export async function GET(req: Request, { params }: Params) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    const image = new URL(req.url).searchParams.get("include") === "image";
    const task = await getImportTask(user, id, { image });
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

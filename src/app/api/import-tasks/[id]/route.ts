import { NextResponse } from "next/server";
import { notFound } from "@/lib/api-errors";
import { discardImportTask, getImportTask } from "@/lib/import/import-tasks";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/import-tasks/:id 任务状态与识别结果，只能读取自己的任务。
 * 默认不含题目图片（状态轮询使用）；?include=image 时附带图片，供校对页加载一次。
 */
export const GET = withUser(async (req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;
    const image = new URL(req.url).searchParams.get("include") === "image";
    const task = await getImportTask(user, id, { image });
    if (!task) return notFound("IMPORT_TASK_NOT_FOUND");
    return NextResponse.json({ task });
});

/** DELETE /api/import-tasks/:id 丢弃任务（保存中的任务不可丢弃） */
export const DELETE = withUser(async (_req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;
    return discardImportTask(user, id);
});

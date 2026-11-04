import { NextResponse } from "next/server";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { clearFinishedBackgroundTasks, listBackgroundTasks } from "@/lib/background-tasks";

/**
 * GET /api/tasks
 * 当前用户的后台事务：进行中的和最近 30 分钟内结束的
 */
export const GET = withUser(async (_req: Request, { user }: AuthenticatedContext) => {
    return NextResponse.json({ tasks: listBackgroundTasks(user.id) });
});

/**
 * DELETE /api/tasks
 * 清除当前用户已结束的事务记录（进行中的不受影响）
 */
export const DELETE = withUser(async (_req: Request, { user }: AuthenticatedContext) => {
    clearFinishedBackgroundTasks(user.id);
    return NextResponse.json({ tasks: listBackgroundTasks(user.id) });
});

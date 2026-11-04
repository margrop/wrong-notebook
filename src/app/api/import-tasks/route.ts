import { NextResponse } from "next/server";
import { badRequest } from "@/lib/api-errors";
import { listImportCenter } from "@/lib/import/import-batches";
import { createImportTask } from "@/lib/import/import-tasks";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

/** GET /api/import-tasks
 * 当前用户的识别导入任务：执行中、待校对、失败的全部返回，已保存的返回最近若干条；
 * 多题批次汇总在 batches 中（批次内的任务不单独列出）
 */
export const GET = withUser(async (_req: Request, { user }: AuthenticatedContext) => {
    return NextResponse.json(await listImportCenter(user));
});

/**
 * POST /api/import-tasks
 * 上传题目图片并创建识别任务，立即返回任务编号（202），识别与入库在服务端后台执行。
 * 同一 clientRequestId 重复提交时返回已有任务（200），不会重复识别。
 */
async function handlePost(req: Request, { user }: AuthenticatedContext) {
    let body: unknown;
    // 读取请求体的用时近似反映上传速度，记入任务的阶段耗时
    const started = Date.now();
    try {
        body = await req.json();
    } catch {
        return badRequest("IMPORT_TASK_INVALID_INPUT");
    }
    const result = await createImportTask(user, body, { receiveMs: Date.now() - started });
    if ('response' in result) return result.response;
    return NextResponse.json({ task: result.task }, { status: result.created ? 202 : 200 });
}

export const POST = withUser(handlePost);

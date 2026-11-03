import { NextResponse } from "next/server";
import { badRequest, unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { listImportCenter } from "@/lib/import-batches";
import { createImportTask } from "@/lib/import-tasks";

/**
 * GET /api/import-tasks
 * 当前用户的识别导入任务：执行中、待校对、失败的全部返回，已保存的返回最近若干条；
 * 多题批次汇总在 batches 中（批次内的任务不单独列出）
 */
export async function GET() {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    return NextResponse.json(await listImportCenter(user));
}

/**
 * POST /api/import-tasks
 * 上传题目图片并创建识别任务，立即返回任务编号（202），识别与入库在服务端后台执行。
 * 同一 clientRequestId 重复提交时返回已有任务（200），不会重复识别。
 */
export async function POST(req: Request) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
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

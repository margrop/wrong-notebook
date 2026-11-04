import { badRequest } from "@/lib/api-errors";
import { confirmImportTask } from "@/lib/import/import-tasks";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

/**
 * POST /api/import-tasks/:id/confirm
 * 校对后确认入库。响应与「添加错题」接口一致（新题 201、重复题 200），并附带任务摘要；
 * 已入库的任务再次确认时直接返回原结果，不重复入库。
 */
async function handlePost(req: Request, { user, params }: { params: Promise<{ id: string }> } & AuthenticatedContext) {
    const { id } = await params;
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return badRequest("QUESTION_SAVE_INVALID_JSON");
    }
    return confirmImportTask(user, id, body);
}

export const POST = withUser(handlePost);

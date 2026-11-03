import { badRequest, unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { confirmImportTask } from "@/lib/import-tasks";

/**
 * POST /api/import-tasks/:id/confirm
 * 校对后确认入库。响应与「添加错题」接口一致（新题 201、重复题 200），并附带任务摘要；
 * 已入库的任务再次确认时直接返回原结果，不重复入库。
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return badRequest("QUESTION_SAVE_INVALID_JSON");
    }
    return confirmImportTask(user, id, body);
}

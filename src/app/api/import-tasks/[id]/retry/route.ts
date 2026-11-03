import { unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { retryImportTask } from "@/lib/import-tasks";

/**
 * POST /api/import-tasks/:id/retry
 * 重试失败的任务：已有识别结果时只重试保存（或回到待校对），不重新调用 AI
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    return retryImportTask(user, id);
}

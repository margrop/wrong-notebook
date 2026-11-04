import { retryImportTask } from "@/lib/import/import-tasks";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

/**
 * POST /api/import-tasks/:id/retry
 * 重试失败的任务：已有识别结果时只重试保存（或回到待校对），不重新调用 AI
 */
export const POST = withUser(async (_req: Request, { user, params }: { params: Promise<{ id: string }> } & AuthenticatedContext) => {
    const { id } = await params;
    return retryImportTask(user, id);
});

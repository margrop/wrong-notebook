import { retryImportBatch } from "@/lib/import/import-batches";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

/**
 * POST /api/import-batches/:id/retry
 * 分题失败时重新分题；已开始的批次只重试失败的题（已有识别结果的只重试保存）
 */
export const POST = withUser(async (_req: Request, { user, params }: { params: Promise<{ id: string }> } & AuthenticatedContext) => {
    const { id } = await params;
    return retryImportBatch(user, id);
});

import { unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { retryImportBatch } from "@/lib/import-batches";

/**
 * POST /api/import-batches/:id/retry
 * 分题失败时重新分题；已开始的批次只重试失败的题（已有识别结果的只重试保存）
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    return retryImportBatch(user, id);
}

import { confirmAllImportBatch } from "@/lib/import/import-batches";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

/** POST /api/import-batches/:id/confirm-all 按识别结果入库其余待校对的题 */
export const POST = withUser(async (_req: Request, { user, params }: { params: Promise<{ id: string }> } & AuthenticatedContext) => {
    const { id } = await params;
    return confirmAllImportBatch(user, id);
});

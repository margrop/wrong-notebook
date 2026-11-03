import { unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { confirmAllImportBatch } from "@/lib/import-batches";

/** POST /api/import-batches/:id/confirm-all 按识别结果入库其余待校对的题 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    return confirmAllImportBatch(user, id);
}

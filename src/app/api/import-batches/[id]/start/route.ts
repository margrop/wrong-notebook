import { badRequest, unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { startImportBatch } from "@/lib/import-batches";

/**
 * POST /api/import-batches/:id/start
 * 确认分题后开始逐题解析；重复提交返回同一批次，不会重复建任务
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return badRequest("IMPORT_BATCH_INVALID_INPUT");
    }
    return startImportBatch(user, id, body);
}

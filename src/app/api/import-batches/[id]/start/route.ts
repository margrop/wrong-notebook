import { badRequest } from "@/lib/api-errors";
import { startImportBatch } from "@/lib/import/import-batches";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

/**
 * POST /api/import-batches/:id/start
 * 确认分题后开始逐题解析；重复提交返回同一批次，不会重复建任务
 */
async function handlePost(req: Request, { user, params }: { params: Promise<{ id: string }> } & AuthenticatedContext) {
    const { id } = await params;
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return badRequest("IMPORT_BATCH_INVALID_INPUT");
    }
    return startImportBatch(user, id, body);
}

export const POST = withUser(handlePost);

import { badRequest, unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { fixImportBatchText } from "@/lib/import-batch-text-fix";
import { withRecoverableResponse } from "@/lib/recoverable-response";

/**
 * POST /api/import-batches/:id/fix-text
 * 为分题预览中的若干题生成「AI 修正文字」建议（删去草稿、修正 OCR 错字），不改动草稿
 */
async function handlePost(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return badRequest("IMPORT_BATCH_INVALID_INPUT");
    }
    return fixImportBatchText(user, id, body);
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);

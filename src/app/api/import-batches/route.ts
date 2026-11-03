import { NextResponse } from "next/server";
import { badRequest, unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { createImportBatch } from "@/lib/import-batches";

/**
 * POST /api/import-batches
 * 创建多题批次：文字按本地规则立即分题（不调用 AI），或在后台由模型分题（文字「用 AI 分题」与照片自动分题）。
 * 同一 clientRequestId 重复提交时返回已有批次。
 */
export async function POST(req: Request) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return badRequest("IMPORT_BATCH_INVALID_INPUT");
    }
    const result = await createImportBatch(user, body);
    if ('response' in result) return result.response;
    return NextResponse.json({ batch: result.batch }, { status: result.created ? 201 : 200 });
}

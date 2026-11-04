import { NextResponse } from "next/server";
import { badRequest, notFound } from "@/lib/api-errors";
import { discardImportBatch, getImportBatch, updateImportBatchDraft } from "@/lib/import/import-batches";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/import-batches/:id 批次草稿与各题进度；?include=image 时附带整页图片（预览页加载一次） */
export const GET = withUser(async (req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;
    const image = new URL(req.url).searchParams.get("include") === "image";
    const batch = await getImportBatch(user, id, { image });
    if (!batch) return notFound("IMPORT_BATCH_NOT_FOUND");
    return NextResponse.json({ batch });
});

/** PATCH /api/import-batches/:id 保存分题草稿（带版本号） */
export const PATCH = withUser(async (req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return badRequest("IMPORT_BATCH_INVALID_DRAFT");
    }
    return updateImportBatchDraft(user, id, body);
});

/** DELETE /api/import-batches/:id 丢弃批次（已入库的错题不受影响） */
export const DELETE = withUser(async (_req: Request, { user, params }: RouteContext & AuthenticatedContext) => {
    const { id } = await params;
    return discardImportBatch(user, id);
});

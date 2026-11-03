import { NextResponse } from "next/server";
import { badRequest, notFound, unauthorized } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { discardImportBatch, getImportBatch, updateImportBatchDraft } from "@/lib/import-batches";

type Params = { params: Promise<{ id: string }> };

/** GET /api/import-batches/:id 批次草稿与各题进度；?include=image 时附带整页图片（预览页加载一次） */
export async function GET(req: Request, { params }: Params) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    const image = new URL(req.url).searchParams.get("include") === "image";
    const batch = await getImportBatch(user, id, { image });
    if (!batch) return notFound("IMPORT_BATCH_NOT_FOUND");
    return NextResponse.json({ batch });
}

/** PATCH /api/import-batches/:id 保存分题草稿（带版本号） */
export async function PATCH(req: Request, { params }: Params) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return badRequest("IMPORT_BATCH_INVALID_DRAFT");
    }
    return updateImportBatchDraft(user, id, body);
}

/** DELETE /api/import-batches/:id 丢弃批次（已入库的错题不受影响） */
export async function DELETE(_req: Request, { params }: Params) {
    const user = await getCurrentUser();
    if (!user) return unauthorized("Authentication required");
    const { id } = await params;
    return discardImportBatch(user, id);
}

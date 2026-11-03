import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, badRequest, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:error-items:image');

/** 与新建错题时的上限一致 */
const MAX_IMAGE_LENGTH = 20 * 1024 * 1024;

const bodySchema = z.object({
    imageDataUrl: z.string()
        .max(MAX_IMAGE_LENGTH)
        .regex(/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/),
});

/** 允许直接输出的原图类型；不输出 SVG 等可执行脚本的格式 */
const SERVABLE_IMAGE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([\s\S]+)$/;

/**
 * GET /api/error-items/:id/image
 * 以二进制图片输出原题图片，供打印预览按需懒加载，避免列表接口携带大段 base64。
 * 链接带 `?v=<更新时间>`，原图替换后链接随之变化，因此可长期缓存。
 */
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const item = await prisma.errorItem.findUnique({ where: { id }, select: { userId: true, originalImageUrl: true } });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }

        const match = item.originalImageUrl.match(SERVABLE_IMAGE);
        if (!match) {
            return notFound("Image not found");
        }

        const body = Buffer.from(match[2], "base64");
        return new Response(new Uint8Array(body), {
            headers: {
                "Content-Type": match[1],
                "Content-Length": String(body.length),
                "Cache-Control": "private, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        logger.error({ error }, 'Error reading original image');
        return internalError("Failed to read image");
    }
}

/**
 * PUT /api/error-items/:id/image
 * 替换（或补充）原题图片；题目文字、配图等其他内容不变
 */
export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const parsed = bodySchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return badRequest("INVALID_IMAGE");
        }

        const item = await prisma.errorItem.findUnique({ where: { id }, select: { userId: true } });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }

        await prisma.errorItem.update({ where: { id }, data: { originalImageUrl: parsed.data.imageDataUrl } });
        logger.info({ errorItemId: id, imageLength: parsed.data.imageDataUrl.length }, 'Original image replaced');
        return NextResponse.json({ originalImageUrl: parsed.data.imageDataUrl });
    } catch (error) {
        logger.error({ error }, 'Error replacing original image');
        return internalError("Failed to replace image");
    }
}

import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, conflict, createErrorResponse, ErrorCode, forbidden, internalError, validationError } from "@/lib/api-errors";
import { DEFAULT_ADMIN_PASSWORD } from "@/lib/default-admin";
import { isInitialized } from "@/lib/initialization";
import { createLogger } from "@/lib/logger";
import { claimSetupToken } from "@/lib/setup-token";

const logger = createLogger("api:initialize");

const initializeSchema = z.object({
    token: z.string().min(1),
    // 与注册一致，支持本地邮箱（如 admin@localhost）
    email: z.string().trim().regex(/^[^\s@]+@[^\s@]+$/),
    name: z.string().trim().min(1).max(50),
    password: z.string().min(6).refine((value) => value !== DEFAULT_ADMIN_PASSWORD),
});

/**
 * POST /api/initialize
 * 全新安装时用一次性初始化链接中的令牌创建第一个管理员；已有管理员后不再可用
 */
export async function POST(req: Request) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return badRequest("Invalid JSON body");
    }
    const parsed = initializeSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid initialization data", parsed.error.issues);
    const { token, email, name, password } = parsed.data;

    try {
        if (await isInitialized()) return conflict("Already initialized");
        // 没有管理员但已有同邮箱的普通用户（极少见），不覆盖其账号
        if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
            return createErrorResponse("Email already exists", 409, ErrorCode.ALREADY_EXISTS);
        }

        const claim = claimSetupToken(token);
        if (!claim) {
            logger.warn("Rejected initialization with an invalid setup token");
            return forbidden("Invalid or expired setup link");
        }

        try {
            const user = await prisma.user.create({
                data: { email, name, password: await hash(password, 12), role: "admin", isActive: true },
                select: { id: true, email: true, name: true },
            });
            claim.consume();
            logger.info({ userId: user.id }, "Initial admin created");
            return NextResponse.json({ user }, { status: 201 });
        } catch (error) {
            claim.release();
            throw error;
        }
    } catch (error) {
        logger.error({ error }, "Failed to initialize");
        return internalError("Failed to initialize");
    }
}

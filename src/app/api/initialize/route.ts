import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, conflict, createErrorResponse, ErrorCode, forbidden, internalError, tooManyRequests, validationError } from "@/lib/api-errors";
import { DEFAULT_ADMIN_PASSWORD } from "@/lib/default-admin";
import { acceptEula } from "@/lib/eula/server";
import { isInitialized } from "@/lib/initialization";
import { createLogger } from "@/lib/logger";
import { getClientIp, registerIpLimiter } from "@/lib/rate-limit";
import { claimSetupToken } from "@/lib/setup-token";
import { recordEvent } from "@/lib/telemetry/server";

const logger = createLogger("api:initialize");

const initializeSchema = z.object({
    token: z.string().min(1),
    // 与注册一致，支持本地邮箱（如 admin@localhost）
    email: z.string().trim().regex(/^[^\s@]+@[^\s@]+$/),
    name: z.string().trim().min(1).max(50),
    password: z.string().min(6).refine((value) => value !== DEFAULT_ADMIN_PASSWORD),
    // 管理员必须同意使用协议（只针对管理员，普通用户注册不涉及）
    eulaAccepted: z.literal(true),
});

/** 写入同意状态并开启外发，记录安装事件；失败只记日志不回滚，实例停留在“未同意、外发关闭”的安全一侧 */
async function recordInstallConsent(): Promise<void> {
    try {
        await acceptEula({ acceptedBy: "initialize", trigger: "install", enableForwarding: true });
    } catch (error) {
        logger.error({ error }, "Failed to save EULA consent");
    }
    await recordEvent("app_installed", { method: "setup-token" });
}

/**
 * POST /api/initialize
 * 全新安装时用一次性初始化链接中的令牌创建第一个管理员；已有管理员后不再可用
 */
export async function POST(req: Request) {
    // 初始化令牌只能用一次，限制同一 IP 的尝试次数，防止猜测令牌
    const ip = getClientIp(req.headers);
    const retryAfter = ip ? registerIpLimiter.retryAfter(ip) : 0;
    if (retryAfter > 0) return tooManyRequests(retryAfter);

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
            if (ip) registerIpLimiter.hit(ip);
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
            await recordInstallConsent();
            return NextResponse.json({ user }, { status: 201 });
        } catch (error) {
            claim.release();
            throw error;
        }
    } catch (error) {
        logger.error({ error }, "Failed to initialize");
        return internalError("Failed to initialize", { error, scope: "api:initialize" });
    }
}

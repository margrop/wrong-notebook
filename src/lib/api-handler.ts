/**
 * API 路由鉴权包装器
 *
 * 统一处理「getServerSession → 按邮箱查用户 → 未登录/用户不存在返回 401 → 管理员校验返回 403」的样板代码，
 * 并统一捕获 handler 抛出的未处理异常（记录日志后返回 500）。
 *
 * 用法：
 *   export const GET = withUser(async (req, { user, session }) => { ... });
 *   export const POST = withAdmin(async (req, { user, session }) => { ... });
 *
 * 与 withRecoverableResponse 组合时，把 withRecoverableResponse 放在外层：
 *   export const POST = withRecoverableResponse(withUser(handler));
 * 这样鉴权失败不会被暂存，成功响应才会按请求编号暂存供断线后取回。
 */

import "server-only";

import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import type { Session } from "next-auth";
import type { User } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createErrorResponse, ErrorCode, unauthorized, forbidden, internalError } from "@/lib/api-errors";
import { isEulaPending } from "@/lib/eula/server";
import { createLogger } from "@/lib/logger";
import { ADMIN_VIEW_AS_COOKIE } from "@/lib/admin-view-as";

const logger = createLogger("api-handler");

/**
 * 未捕获 API 错误的 scope：用实际路由代替笼统的 api:unhandled。
 * 动态 ID 片段折叠为 id，便于在错误看板按接口定位；不含查询串与用户数据。
 */
export function apiScopeFromRequest(req?: Request): string {
    if (!req) return "api:unhandled";
    try {
        const path = new URL(req.url).pathname;
        const segments = path.split("/").filter(Boolean);
        if (segments[0] !== "api") return "api:unhandled";
        const token = segments.slice(1)
            .map((segment) => (/^\d{3,}$/.test(segment) || /^[a-z0-9]{16,}$/i.test(segment) ? "id" : segment))
            .join(".");
        return `api:${token || "root"}`.slice(0, 64);
    } catch {
        return "api:unhandled";
    }
}

/** 包装后的 handler 上下文：原有路由上下文加上当前登录用户与 session */
export interface AuthenticatedContext {
    user: User;
    session: Session;
}

type Handler<Context> = (req: Request, ctx: Context) => Promise<Response>;

type AnyContext = Record<string, unknown>;

async function resolveUser(): Promise<{ user: User; session: Session } | { error: Response }> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return { error: unauthorized("Authentication required") };
    }
    // JWT 会话可能在账号被停用或降权后仍然存在一段时间，不能只相信 token 中的邮箱和角色。
    // 新会话优先按不可变的用户 ID 查找；旧会话没有 ID 时再回退到邮箱。
    const principal = session.user.id
        ? await prisma.user.findUnique({ where: { id: session.user.id } })
        : await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!principal || principal.isActive === false) {
        return { error: unauthorized("Authentication required") };
    }

    // 管理员角色以数据库当前值为准，避免旧 JWT 在降权后继续获得管理员权限。
    const principalSession = principal.id === session.user.id
        && principal.email === session.user.email
        && principal.role === session.user.role
        ? session
        : {
            ...session,
            user: {
                ...session.user,
                id: principal.id,
                email: principal.email,
                role: principal.role,
            },
        };

    // 管理员「以某用户身份查看」：普通接口按目标用户执行，鉴权仍以管理员会话为准
    if (principal.role === "admin") {
        try {
            const targetId = (await cookies()).get(ADMIN_VIEW_AS_COOKIE)?.value;
            if (targetId && targetId !== principal.id) {
                const target = await prisma.user.findUnique({ where: { id: targetId } });
                if (target) return { user: target, session: principalSession };
            }
        } catch {
            // 非请求上下文（如直接调用路由的测试）没有 cookie 存储，按管理员本人处理
        }
    }

    return { user: principal, session: principalSession };
}

export interface AdminRouteOptions {
    /** 协议待重新同意时仍允许写操作（只用于同意接口） */
    allowEulaPending?: boolean;
}

/** 协议升级后管理员重新同意前，拦截管理写操作（GET/HEAD 不受影响）；读取配置失败时不拦截 */
function eulaPendingFor(req: Request | undefined): boolean {
    const method = (req?.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") return false;
    try {
        return isEulaPending();
    } catch {
        return false;
    }
}

function wrapWithAuth<Context extends AnyContext>(
    requireAdmin: boolean,
    handler: Handler<Context & AuthenticatedContext>,
    options: AdminRouteOptions = {}
): (req?: Request, ctx?: Context) => Promise<Response> {
    return async (req?: Request, ctx?: Context): Promise<Response> => {
        const resolved = await resolveUser();
        if ("error" in resolved) {
            return resolved.error;
        }
        if (requireAdmin && resolved.session.user.role !== "admin") {
            return forbidden("Admin access required");
        }
        if (requireAdmin && !options.allowEulaPending && eulaPendingFor(req)) {
            return createErrorResponse("EULA_PENDING", 409, ErrorCode.EULA_PENDING);
        }
        try {
            const context = { ...(ctx ?? {} as Context), user: resolved.user, session: resolved.session };
            return await handler(req ?? new Request("http://localhost"), context);
        } catch (error) {
            logger.error({ error }, "Unhandled error in API route");
            return internalError(undefined, { error, scope: apiScopeFromRequest(req) });
        }
    };
}

/**
 * 要求已登录的 API 路由包装器。
 * 未登录或用户不存在时返回 401；handler 抛错时记录日志并返回 500。
 * req 与 ctx 参数可选，兼容测试中直接以 0 参或 1 参调用的情况。
 */
export function withUser<Context extends AnyContext = AnyContext>(
    handler: Handler<Context & AuthenticatedContext>
): (req?: Request, ctx?: Context) => Promise<Response> {
    return wrapWithAuth(false, handler);
}

/**
 * 要求管理员的 API 路由包装器。
 * 在未登录/用户不存在时返回 401，非管理员时返回 403；handler 抛错时记录日志并返回 500。
 * 管理员判定与现有 requireAdmin 一致：session.user.role === 'admin'。
 * 使用协议升级后管理员重新同意前，非 GET 请求返回 409 EULA_PENDING。
 */
export function withAdmin<Context extends AnyContext = AnyContext>(
    handler: Handler<Context & AuthenticatedContext>,
    options?: AdminRouteOptions
): (req?: Request, ctx?: Context) => Promise<Response> {
    return wrapWithAuth(true, handler, options);
}

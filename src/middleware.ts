import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { createLogger } from "@/lib/logger";

const logger = createLogger('middleware');

export async function middleware(req: NextRequest) {
    // Debug logging for middleware
    logger.debug({ method: req.method, path: req.nextUrl.pathname }, 'Processing request');

    try {
        const token = await getToken({
            req,
            secret: process.env.NEXTAUTH_SECRET,
            cookieName: "next-auth.session-token", // Explicitly look for the standardized cookie
        });

        const isAuth = !!token;
        // /initialize：全新安装时用一次性初始化链接创建管理员，未登录也要能打开
        const isAuthPage = ["/login", "/register", "/initialize"].some((prefix) => req.nextUrl.pathname.startsWith(prefix));
        const isAdminPage = req.nextUrl.pathname.startsWith("/admin");

        logger.debug({
            path: req.nextUrl.pathname,
            isAuth,
            isAuthPage,
            hasToken: !!token,
            cookies: req.cookies.getAll().map(c => c.name)
        }, 'Auth status');

        if (isAuthPage) {
            if (isAuth) {
                logger.debug('Redirecting authenticated user to /');
                return NextResponse.redirect(new URL("/", req.url));
            }
            return null;
        }

        if (!isAuth) {
            let from = req.nextUrl.pathname;
            if (req.nextUrl.search) {
                from += req.nextUrl.search;
            }

            logger.debug({ callbackUrl: from }, 'Redirecting unauthenticated user to login');
            return NextResponse.redirect(
                new URL(`/login?callbackUrl=${encodeURIComponent(from)}`, req.url)
            );
        }

        // 管理员仍使用默认密码时，所有页面都先跳到安装向导改密码
        const isSetupPage = req.nextUrl.pathname.startsWith("/setup");
        if (token?.mustChangePassword && !isSetupPage) {
            logger.info({ userId: token.id, path: req.nextUrl.pathname }, 'Redirecting admin with default password to /setup');
            return NextResponse.redirect(new URL("/setup", req.url));
        }

        // Admin route protection: only allow users with admin role
        if (isAdminPage && token?.role !== "admin") {
            logger.warn({ userId: token?.id, path: req.nextUrl.pathname }, 'Non-admin user attempting to access admin area');
            return NextResponse.redirect(new URL("/", req.url));
        }
    } catch (e) {
        logger.error({ error: e }, 'Error processing token');
        return NextResponse.next();
    }
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - icons/、manifest.webmanifest（PWA 图标与清单，登录页也要能加载）
         * - sw.js、offline.html（Service Worker 与离线页，未登录时也要能加载）
         */
        "/((?!api|_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|offline.html).*)",
    ],
};

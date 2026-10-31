import { NextAuthOptions } from "next-auth"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import { compare } from "bcryptjs"
import { createLogger } from "@/lib/logger"
import { DEFAULT_ADMIN_PASSWORD, isDefaultAdminPassword } from "@/lib/default-admin"
import { TOO_MANY_ATTEMPTS } from "@/lib/auth-errors"
import { getClientIp, loginAccountLimiter, loginIpLimiter } from "@/lib/rate-limit"

const logger = createLogger('auth');

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(prisma),
    session: {
        strategy: "jwt",
    },
    // @ts-expect-error trustHost is a valid option in newer NextAuth versions but types might be lagging
    trustHost: true,
    pages: {
        signIn: "/login",
    },
    // Force using a single cookie name to avoid HTTP/HTTPS mismatches in proxy environments
    // This allows running without NEXTAUTH_URL behind Cloudflare Tunnel
    cookies: {
        sessionToken: {
            name: "next-auth.session-token",
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                // Only use secure cookies if explicitly running on HTTPS (via NEXTAUTH_URL)
                // This enables HTTP local IP access in Docker/Production if NEXTAUTH_URL is unset
                secure: process.env.NODE_ENV === "production" && process.env.NEXTAUTH_URL?.startsWith("https"),
            },
        },
    },
    providers: [
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials, req) {
                logger.debug({ email: credentials?.email }, 'Authorize called');
                if (!credentials?.email || !credentials?.password) {
                    logger.debug('Missing credentials');
                    return null
                }

                // 防暴力破解：账号或来源 IP 失败次数过多时，在校验密码前直接拒绝
                const ip = getClientIp(req?.headers);
                const accountKey = credentials.email.trim().toLowerCase();
                if (loginAccountLimiter.retryAfter(accountKey) > 0 || loginIpLimiter.retryAfter(ip) > 0) {
                    logger.warn({ email: accountKey, ip }, 'Login locked after too many failed attempts');
                    throw new Error(TOO_MANY_ATTEMPTS)
                }
                const recordFailure = () => {
                    loginAccountLimiter.hit(accountKey);
                    loginIpLimiter.hit(ip);
                };

                const user = await prisma.user.findUnique({
                    where: {
                        email: credentials.email
                    }
                })

                if (!user) {
                    logger.debug('User not found');
                    recordFailure();
                    return null
                }

                // Check if user is active
                if (!user.isActive) {
                    logger.warn('User is disabled');
                    throw new Error("Account is disabled")
                }

                const isPasswordValid = await compare(credentials.password, user.password)

                if (!isPasswordValid) {
                    logger.debug('Invalid password');
                    recordFailure();
                    return null
                }

                loginAccountLimiter.reset(accountKey);

                logger.info({ email: user.email }, 'Login successful');

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    mustChangePassword: isDefaultAdminPassword(user.role, credentials.password),
                }
            }
        })
    ],
    // Enable debug messages in the console
    debug: true,
    logger: {
        error(code, metadata) {
            logger.error({ code, metadata }, 'NextAuth error');
        },
        warn(code) {
            logger.warn({ code }, 'NextAuth warning');
        },
        debug(code, metadata) {
            logger.debug({ code, metadata }, 'NextAuth debug');
        }
    },
    callbacks: {
        async session({ session, token }) {
            logger.debug({ userId: token.id }, 'Session callback');
            return {
                ...session,
                user: {
                    ...session.user,
                    id: token.id,
                    role: token.role,
                    mustChangePassword: token.mustChangePassword === true,
                }
            }
        },
        async jwt({ token, user, trigger }) {
            if (user) {
                logger.debug({ userId: user.id }, 'JWT callback - Initial signin');
                return {
                    ...token,
                    id: user.id,
                    role: user.role,
                    mustChangePassword: user.mustChangePassword === true,
                }
            }
            // 客户端改完密码后调用 update()，以数据库中的密码为准重新判断，不信任客户端传值
            if (trigger === "update" && token.mustChangePassword) {
                const dbUser = await prisma.user.findUnique({ where: { id: token.id }, select: { password: true } })
                const stillDefault = !!dbUser && await compare(DEFAULT_ADMIN_PASSWORD, dbUser.password)
                logger.info({ userId: token.id, stillDefault }, 'JWT callback - Re-checked default password')
                return { ...token, mustChangePassword: stillDefault }
            }
            logger.debug('JWT callback - Subsequent call');
            return token
        }
    }
}

// Log startup check
logger.info({
    NODE_ENV: process.env.NODE_ENV,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    HAS_SECRET: !!process.env.NEXTAUTH_SECRET,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST
}, 'AuthConfig loading');

import "server-only";

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";

/** MCP 服务配置：集成密钥与固定目标账号 */
export interface McpConfig {
    apiKey: string;
    userEmail: string;
}

/** 读取 MCP 环境变量；密钥或目标账号缺失时返回 null（服务未启用） */
export function readMcpConfig(): McpConfig | null {
    const apiKey = process.env.MCP_API_KEY?.trim();
    const userEmail = process.env.MCP_USER_EMAIL?.trim();
    if (!apiKey || !userEmail) return null;
    return { apiKey, userEmail };
}

/**
 * 从请求头读取 MCP 集成密钥：优先 Authorization: Bearer，其次 x-api-key。
 */
export function extractMcpApiKey(req: Request): string | null {
    const authorization = req.headers.get("authorization");
    if (authorization?.startsWith("Bearer ")) {
        return authorization.slice("Bearer ".length).trim() || null;
    }
    return req.headers.get("x-api-key")?.trim() || null;
}

/** 定长比较，避免按字符逐位比较泄漏密钥前缀 */
export function isValidMcpApiKey(candidate: string, expected: string): boolean {
    const candidateBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);
    return candidateBuffer.length === expectedBuffer.length
        && timingSafeEqual(candidateBuffer, expectedBuffer);
}

export type McpAuthResult =
    | { ok: true; user: User }
    | { ok: false; status: number; message: string };

/**
 * 校验集成密钥并解析 MCP_USER_EMAIL（邮箱或用户名）对应的启用账号。
 * 未配置时返回 503；密钥错误或账号不存在/已停用时返回 401。
 */
export async function authenticateMcpRequest(req: Request): Promise<McpAuthResult> {
    const config = readMcpConfig();
    if (!config) {
        return {
            ok: false,
            status: 503,
            message: "MCP server is not configured: set MCP_API_KEY and MCP_USER_EMAIL",
        };
    }

    const apiKey = extractMcpApiKey(req);
    if (!apiKey || !isValidMcpApiKey(apiKey, config.apiKey)) {
        return { ok: false, status: 401, message: "Missing or invalid MCP API key" };
    }

    const user = await prisma.user.findFirst({
        where: {
            OR: [{ email: config.userEmail }, { name: config.userEmail }],
            isActive: true,
        },
    });
    if (!user) {
        return { ok: false, status: 401, message: "MCP user not found or disabled" };
    }

    return { ok: true, user };
}

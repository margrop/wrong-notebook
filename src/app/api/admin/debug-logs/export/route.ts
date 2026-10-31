import os from "os";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-utils";
import { forbidden, unauthorized } from "@/lib/api-errors";
import { getAppVersion } from "@/lib/app-version";
import { getAppConfig } from "@/lib/config";
import { getDebugLogEntries, getDebugLogStatus, sanitizeForDebug } from "@/lib/debug-log";

export const dynamic = 'force-dynamic';

/** 数据库地址只保留协议，避免泄露路径或账号 */
function describeDatabase(url: string | undefined): string {
    if (!url) return 'unset';
    return url.split(':')[0] || 'unknown';
}

/**
 * GET /api/admin/debug-logs/export
 * 导出调试日志及运行环境、脱敏后的配置，供管理员发送给作者排查问题
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) return unauthorized();
    if (!requireAdmin(session)) return forbidden("Admin access required");

    const now = new Date();
    const memory = process.memoryUsage();
    const report = {
        format: 'wrong-notebook-debug-log',
        formatVersion: 1,
        exportedAt: now.toISOString(),
        app: {
            version: getAppVersion(),
            nodeEnv: process.env.NODE_ENV,
            logLevel: process.env.LOG_LEVEL || null,
            database: describeDatabase(process.env.DATABASE_URL),
            customConfigDir: Boolean(process.env.CONFIG_DIR),
        },
        runtime: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            osRelease: os.release(),
            uptimeSeconds: Math.round(process.uptime()),
            memoryMB: {
                rss: Math.round(memory.rss / 1024 / 1024),
                heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
            },
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        debug: getDebugLogStatus(now.getTime()),
        config: sanitizeForDebug(getAppConfig()),
        entries: getDebugLogEntries(),
    };

    const stamp = now.toISOString().replace(/[:.]/g, '-');
    return new NextResponse(JSON.stringify(report, null, 2), {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="wrong-notebook-debug-${stamp}.json"`,
            'Cache-Control': 'no-store',
        },
    });
}

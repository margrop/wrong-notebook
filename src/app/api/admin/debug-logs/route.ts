import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-utils";
import { badRequest, forbidden, unauthorized } from "@/lib/api-errors";
import { clearDebugLogs, getDebugLogStatus, setDebugMode } from "@/lib/debug-log";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:admin:debug-logs');

const toggleSchema = z.object({ enabled: z.boolean() });

export const dynamic = 'force-dynamic';

async function checkAdmin() {
    const session = await getServerSession(authOptions);
    if (!session?.user) return { error: unauthorized() };
    if (!requireAdmin(session)) return { error: forbidden("Admin access required") };
    return { session };
}

/** 查询调试模式状态与已记录的日志条数 */
export async function GET() {
    const { error } = await checkAdmin();
    if (error) return error;
    return NextResponse.json(getDebugLogStatus());
}

/** 开启或关闭调试模式；开启时清空上一轮的调试日志 */
export async function POST(req: Request) {
    const { error, session } = await checkAdmin();
    if (error) return error;

    const parsed = toggleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest('INVALID_DEBUG_MODE');

    const { enabled } = parsed.data;
    // 关闭前先记一条，开启后再记一条，导出的日志里能看到起止时间与操作人
    if (!enabled) logger.info({ userId: session.user.id }, 'Debug mode disabled');
    const status = setDebugMode(enabled);
    if (enabled) logger.info({ userId: session.user.id, expiresAt: status.expiresAt }, 'Debug mode enabled');
    return NextResponse.json(getDebugLogStatus());
}

/** 清空已记录的调试日志，不改变调试模式开关 */
export async function DELETE() {
    const { error } = await checkAdmin();
    if (error) return error;
    clearDebugLogs();
    return NextResponse.json(getDebugLogStatus());
}

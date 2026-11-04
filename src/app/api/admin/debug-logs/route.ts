import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { z } from "zod";
import { badRequest } from "@/lib/api-errors";
import { clearDebugLogs, getDebugLogStatus, setDebugMode } from "@/lib/debug-log";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:admin:debug-logs');

const toggleSchema = z.object({ enabled: z.boolean() });

export const dynamic = 'force-dynamic';

/** 查询调试模式状态与已记录的日志条数 */
export const GET = withAdmin(async () => {
    return NextResponse.json(getDebugLogStatus());
});

/** 开启或关闭调试模式；开启时清空上一轮的调试日志 */
async function handlePost(req: Request, { session }: AuthenticatedContext) {
    const parsed = toggleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest('INVALID_DEBUG_MODE');

    const { enabled } = parsed.data;
    // 关闭前先记一条，开启后再记一条，导出的日志里能看到起止时间与操作人
    if (!enabled) logger.info({ userId: session.user.id }, 'Debug mode disabled');
    const status = setDebugMode(enabled);
    if (enabled) logger.info({ userId: session.user.id, expiresAt: status.expiresAt }, 'Debug mode enabled');
    return NextResponse.json(getDebugLogStatus());
}

export const POST = withAdmin(handlePost);

/** 清空已记录的调试日志，不改变调试模式开关 */
export const DELETE = withAdmin(async () => {
    clearDebugLogs();
    return NextResponse.json(getDebugLogStatus());
});

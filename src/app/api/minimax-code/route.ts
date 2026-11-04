import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-handler";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { logout } from "@/lib/minimax-code/auth";
import { getMiniMaxCodeStatus } from "@/lib/minimax-code/status";

const logger = createLogger('api:minimax-code');

export const dynamic = 'force-dynamic';

/** GET /api/minimax-code：账号登录状态与剩余积分（仅管理员） */
export const GET = withAdmin(async () => {
    try {
        return NextResponse.json(await getMiniMaxCodeStatus());
    } catch (error) {
        logger.error({ error }, 'Failed to get MiniMax Code status');
        return internalError("Failed to get MiniMax Code status");
    }
});

/** DELETE /api/minimax-code：退出登录，删除保存的凭据（仅管理员） */
export const DELETE = withAdmin(async () => {
    try {
        logout();
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error({ error }, 'Failed to log out MiniMax Code');
        return internalError("Failed to log out");
    }
});

import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-handler";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { runCheckin } from "@/lib/minimax-code/checkin";

const logger = createLogger('api:minimax-code:checkin');

export const dynamic = 'force-dynamic';

/** POST /api/minimax-code/checkin：立即签到一次，返回签到记录（仅管理员） */
export const POST = withAdmin(async () => {
    try {
        return NextResponse.json(await runCheckin('manual'));
    } catch (error) {
        logger.error({ error }, 'Failed to check in MiniMax Code');
        return internalError("Failed to check in");
    }
});

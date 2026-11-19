import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-handler";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { runCheckin } from "@/lib/minimax-code/checkin";
import { resolveMiniMaxCodeSite } from "@/lib/minimax-code/constants";

const logger = createLogger('api:minimax-code:checkin');

export const dynamic = 'force-dynamic';

/** POST /api/minimax-code/checkin：立即签到一次，返回签到记录（?site=global 为国际站；仅管理员） */
export const POST = withAdmin(async (req?: Request) => {
    try {
        const site = resolveMiniMaxCodeSite(req ? new URL(req.url).searchParams.get('site') : null);
        return NextResponse.json(await runCheckin('manual', site));
    } catch (error) {
        logger.error({ error }, 'Failed to check in MiniMax Code');
        return internalError("Failed to check in");
    }
});

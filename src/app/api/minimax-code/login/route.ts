import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-handler";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { pollLogin, startLogin } from "@/lib/minimax-code/auth";
import { resolveMiniMaxCodeSite } from "@/lib/minimax-code/constants";

const logger = createLogger('api:minimax-code:login');

export const dynamic = 'force-dynamic';

/** POST /api/minimax-code/login：发起网页登录（OAuth 设备码），返回授权地址（?site=global 为国际站；仅管理员） */
export const POST = withAdmin(async (req?: Request) => {
    try {
        const site = resolveMiniMaxCodeSite(req ? new URL(req.url).searchParams.get('site') : null);
        return NextResponse.json(await startLogin(site));
    } catch (error) {
        logger.error({ error }, 'Failed to start MiniMax Code login');
        return internalError("Failed to start MiniMax Code login");
    }
});

/** GET /api/minimax-code/login：轮询一次授权结果（?site=global 为国际站；仅管理员） */
export const GET = withAdmin(async (req?: Request) => {
    try {
        const site = resolveMiniMaxCodeSite(req ? new URL(req.url).searchParams.get('site') : null);
        return NextResponse.json(await pollLogin(site));
    } catch (error) {
        logger.error({ error }, 'Failed to poll MiniMax Code login');
        return internalError("Failed to poll MiniMax Code login");
    }
});

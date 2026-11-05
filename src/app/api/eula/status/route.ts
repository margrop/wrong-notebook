import { NextResponse } from "next/server";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { getEulaStatus } from "@/lib/eula/server";

export const dynamic = "force-dynamic";

/** GET /api/eula/status：协议状态；普通用户始终 pending:false（协议只针对管理员） */
export const GET = withUser(async (_req: Request, { session }: AuthenticatedContext) => {
    return NextResponse.json(getEulaStatus(session.user.role === "admin"));
});

import { NextResponse } from "next/server";
import { notFound } from "@/lib/api-errors";
import { getStoredResponse, parseRequestId } from "@/lib/recoverable-response";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/requests/:id
 * 取回被浏览器中断的耗时请求的结果：{ state: 'running' } 或 { state: 'done', status, body }；
 * 请求没有到达服务端或结果已过期时返回 404
 */
export const GET = withUser(async (_req: Request, { params }: AuthenticatedContext & RouteContext) => {
    const id = parseRequestId((await params).id);
    const stored = id ? getStoredResponse(id) : null;
    if (!stored) {
        return notFound("Request not found");
    }
    return NextResponse.json(stored);
});

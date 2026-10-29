import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { notFound, unauthorized } from "@/lib/api-errors";
import { getStoredResponse, parseRequestId } from "@/lib/recoverable-response";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/requests/:id
 * 取回被浏览器中断的耗时请求的结果：{ state: 'running' } 或 { state: 'done', status, body }；
 * 请求没有到达服务端或结果已过期时返回 404
 */
export async function GET(_req: Request, { params }: RouteContext) {
    const user = await getCurrentUser();
    if (!user) {
        return unauthorized("Authentication required");
    }
    const id = parseRequestId((await params).id);
    const stored = id ? getStoredResponse(id) : null;
    if (!stored) {
        return notFound("Request not found");
    }
    return NextResponse.json(stored);
}

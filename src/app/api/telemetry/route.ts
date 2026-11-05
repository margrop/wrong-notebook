import { NextResponse } from "next/server";
import { z } from "zod";
import { createErrorResponse, ErrorCode, tooManyRequests, validationError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getClientIp, telemetryIpLimiter } from "@/lib/rate-limit";
import { CLIENT_EVENT_NAMES, ERROR_SCOPE_PATTERN, parseEventPayload } from "@/lib/telemetry/schema";
import { getTelemetryState, recordEvent, writeMode, writeTelemetryError } from "@/lib/telemetry/server";

const logger = createLogger("api:telemetry");

/** 单次上报的请求体上限 */
const MAX_BODY_BYTES = 16 * 1024;

const eventSchema = z.strictObject({
    t: z.literal("event"),
    name: z.enum(CLIENT_EVENT_NAMES),
    payload: z.record(z.string(), z.unknown()).optional(),
});

const errorSchema = z.strictObject({
    t: z.literal("error"),
    // 浏览器只能上报客户端与渲染错误，服务端错误由服务端直接记录
    kind: z.enum(["client", "boundary"]),
    scope: z.string().regex(ERROR_SCOPE_PATTERN),
    name: z.string().max(200),
    message: z.string().max(2000).optional(),
    stack: z.string().max(8000).optional(),
    path: z.string().max(2000).optional(),
    userAgent: z.string().max(500).optional(),
});

const bodySchema = z.discriminatedUnion("t", [eventSchema, errorSchema]);

const notAccepted = () => NextResponse.json({ accepted: false }, { status: 202 });

/**
 * POST /api/telemetry
 * 浏览器上报匿名事件与错误（不需要登录）。遥测关闭时返回 202 且不写库；
 * 本路由自身出错时不调用 reportServerError，防止递归
 */
export async function POST(req: Request) {
    const ip = getClientIp(req.headers) ?? "unknown";
    const retryAfter = telemetryIpLimiter.retryAfter(ip);
    if (retryAfter > 0) return tooManyRequests(retryAfter);
    telemetryIpLimiter.hit(ip);

    let text: string;
    try {
        text = await req.text();
    } catch {
        return validationError("Invalid telemetry body");
    }
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
        return createErrorResponse("Payload too large", 413, ErrorCode.BAD_REQUEST);
    }

    const state = getTelemetryState();
    if (!writeMode(state).write) return notAccepted();

    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return validationError("Invalid telemetry body");
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return validationError("Invalid telemetry body");
    const body = parsed.data;

    try {
        if (body.t === "event") {
            const payload = parseEventPayload(body.name, body.payload);
            if (!payload) return validationError("Invalid telemetry payload");
            return NextResponse.json({ accepted: await recordEvent(body.name, payload, state) });
        }
        if (!state.errors) return notAccepted();
        const fingerprint = await writeTelemetryError(body, state);
        return NextResponse.json({ accepted: fingerprint !== null });
    } catch (error) {
        logger.warn({ error }, "Failed to store telemetry");
        return NextResponse.json({ accepted: false }, { status: 202 });
    }
}

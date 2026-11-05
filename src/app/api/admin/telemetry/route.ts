import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, createErrorResponse, ErrorCode } from "@/lib/api-errors";
import { withAdmin } from "@/lib/api-handler";
import { updateAppConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { getTelemetryAdminResponse, getTelemetryAdminStatus, isValidTelemetryEndpoint } from "@/lib/telemetry/admin";
import { clearTelemetry, purgeTelemetry } from "@/lib/telemetry/server";
import { getTelemetryState } from "@/lib/telemetry/state";
import type { TelemetryConfig } from "@/lib/config";

const logger = createLogger("api:admin:telemetry");

const updateSchema = z.strictObject({
    recording: z.boolean().optional(),
    errors: z.boolean().optional(),
    forwarding: z.boolean().optional(),
    endpoint: z.string().trim().max(500).optional(),
    retentionDays: z.number().int().min(1).max(365).optional(),
    /** 关闭存量实例的告知横幅 */
    noticeDismissed: z.literal(true).optional(),
});

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/telemetry：遥测开关、协议状态、待发数量、上次外发结果与最近记录；
 * ?view=notice 只返回状态（横幅用），否则先按保留期清理一次
 */
export const GET = withAdmin(async (req: Request) => {
    if (new URL(req.url).searchParams.get("view") === "notice") {
        return NextResponse.json(await getTelemetryAdminStatus());
    }
    await purgeTelemetry();
    return NextResponse.json(await getTelemetryAdminResponse());
});

/** POST /api/admin/telemetry：修改开关、地址与保留天数；未同意协议时不能开启外发 */
export const POST = withAdmin(async (req: Request) => {
    const parsed = updateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest("INVALID_TELEMETRY_SETTINGS");
    const { noticeDismissed, ...changes } = parsed.data;
    const state = getTelemetryState();

    if (Object.keys(changes).length > 0 && state.lockedByEnv) {
        return createErrorResponse("TELEMETRY_LOCKED", 409, ErrorCode.CONFLICT);
    }
    if (changes.forwarding === true && (!state.consentGiven || state.consentPending)) {
        return createErrorResponse("EULA_REQUIRED", 409, ErrorCode.CONFLICT);
    }
    if (changes.endpoint !== undefined && !isValidTelemetryEndpoint(changes.endpoint)) {
        return badRequest("INVALID_TELEMETRY_ENDPOINT");
    }

    const telemetry: TelemetryConfig = { ...changes };
    if (noticeDismissed) telemetry.noticeDismissedAt = new Date().toISOString();
    updateAppConfig({ telemetry });
    logger.info({ changes: Object.keys(telemetry) }, "Telemetry settings updated");
    return NextResponse.json(await getTelemetryAdminResponse());
});

/** DELETE /api/admin/telemetry：立即清空全部遥测记录（含待发） */
export const DELETE = withAdmin(async () => {
    const count = await clearTelemetry();
    logger.info({ count }, "Telemetry records cleared");
    return NextResponse.json(await getTelemetryAdminResponse());
});

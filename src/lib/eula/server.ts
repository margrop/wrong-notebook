import "server-only";

import { getAppConfig, updateAppConfig } from "@/lib/config";
import { EULA_CHANGES, EULA_VERSION } from "@/lib/eula";
import { createLogger } from "@/lib/logger";
import { recordEvent } from "@/lib/telemetry/server";
import type { EulaConfig } from "@/lib/config";
import type { EulaStatus } from "@/lib/eula/types";

const logger = createLogger("eula");

/** 曾同意过协议、但版本低于当前版本 */
export function isEulaPending(eula: EulaConfig | undefined = getAppConfig().eula): boolean {
    return !!eula?.acceptedVersion && eula.acceptedVersion !== EULA_VERSION;
}

export function getEulaStatus(isAdmin: boolean): EulaStatus {
    const eula = getAppConfig().eula;
    return {
        pending: isAdmin && isEulaPending(eula),
        current: EULA_VERSION,
        accepted: eula?.acceptedVersion ?? null,
        acceptedAt: eula?.acceptedAt ?? null,
        changes: EULA_CHANGES[EULA_VERSION] ?? { zh: [], en: [] },
    };
}

/**
 * 写入同意状态（实例级，不记录是哪位管理员）。
 * enableForwarding 为 true 时同时开启外发（新安装同意协议时默认开启）；之后记录 eula_accepted 事件
 */
export async function acceptEula(options: {
    acceptedBy: NonNullable<EulaConfig["acceptedBy"]>;
    trigger: "install" | "upgrade" | "settings";
    version?: string;
    enableForwarding?: boolean;
}): Promise<void> {
    const version = options.version ?? EULA_VERSION;
    updateAppConfig({
        eula: { acceptedVersion: version, acceptedAt: new Date().toISOString(), acceptedBy: options.acceptedBy },
        ...(options.enableForwarding ? { telemetry: { forwarding: true } } : {}),
    });
    logger.info({ version, acceptedBy: options.acceptedBy }, "EULA accepted");
    await recordEvent("eula_accepted", { version, trigger: options.trigger });
}

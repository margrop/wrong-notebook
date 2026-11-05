import "server-only";

import type { AiUsageKind } from "@/lib/ai-quota";
import { serializeWrite } from "@/lib/db-write-queue";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { CompletionEvent } from "./completion";

const logger = createLogger('ai:usage');

/** 触发 AI 调用的操作：计入额度的用户操作，以及后台自动的掌握概率评估 */
export type AiCallKind = AiUsageKind | 'mastery';

/** 一次 AI 调用归属的用户和操作 */
export interface AiCallScope {
    userId: string;
    kind: AiCallKind;
}

/** 写入一次补全的用量记录；失败只记日志，不影响业务 */
export async function recordAiCompletion(scope: AiCallScope, provider: string, event: CompletionEvent): Promise<void> {
    try {
        await serializeWrite(() => prisma.aiCompletion.create({
            data: {
                userId: scope.userId,
                kind: scope.kind,
                task: event.task,
                provider,
                model: event.model?.slice(0, 200) ?? null,
                inputTokens: event.usage?.inputTokens ?? null,
                outputTokens: event.usage?.outputTokens ?? null,
                requestId: event.requestId?.slice(0, 200) ?? null,
                durationMs: Math.max(0, Math.round(event.durationMs)),
                status: event.status,
                errorCode: event.errorCode ?? null,
            },
        }));
    } catch (error) {
        logger.error({ error, userId: scope.userId, kind: scope.kind, task: event.task }, 'Failed to record AI completion');
    }
}

import "server-only";

import { getAppConfig, getAppTimeZone } from "@/lib/config";
import { getDayRange } from "@/lib/date-time";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { AiAccessDenial, AiAuthorizeScope } from "./account";
import type { AiUsageKind } from "@/lib/ai-quota";

const logger = createLogger('ai:daily-limit');

// 额度预占是很短的写事务；单独串行化，避免与调用方已有的写队列嵌套等待。
let reservationQueue: Promise<unknown> = Promise.resolve();

function serializeReservation<T>(operation: () => Promise<T>): Promise<T> {
    const run = reservationQueue.then(operation);
    reservationQueue = run.catch(() => undefined);
    return run;
}

/** 用户在应用时区的今天已发起的 AI 调用次数 */
export async function countTodayAiUsage(userId: string, now = new Date()): Promise<number> {
    const { start, end } = getDayRange(now, getAppTimeZone());
    return prisma.aiUsage.count({ where: { userId, createdAt: { gte: start, lt: end } } });
}

/**
 * 原子预占一次 AI 用量：先把旧 AiUsage 明细迁入当天计数，再在同一事务内递增计数并写入明细。
 * 事务失败时沿用旧行为放行，避免额度统计故障阻断正常 AI 功能。
 */
export async function reserveDailyAiUsage(
    user: { id: string; role?: string | null },
    kind: AiUsageKind,
): Promise<AiAccessDenial | null> {
    const limit = getAppConfig().aiDailyLimit ?? 0;
    if (limit <= 0 || user.role === 'admin') {
        try {
            await prisma.aiUsage.create({ data: { userId: user.id, kind } });
        } catch (error) {
            logger.error({ error, userId: user.id, kind }, 'Failed to record AI usage');
        }
        return null;
    }

    const { start, end } = getDayRange(new Date(), getAppTimeZone());
    const day = start.toISOString();
    try {
        let reserved = false;
        for (let attempt = 0; ; attempt++) {
            try {
                reserved = await serializeReservation(() => prisma.$transaction(async (tx) => {
                    const current = await tx.aiDailyUsage.findUnique({
                        where: { userId_day: { userId: user.id, day } },
                        select: { count: true },
                    });
                    let count = current?.count ?? 0;
                    if (!current) {
                        // 首次启用新计数表时继承当天已有的明细，避免升级瞬间重置额度。
                        count = await tx.aiUsage.count({ where: { userId: user.id, createdAt: { gte: start, lt: end } } });
                    }
                    if (count >= limit) return false;

                    if (current) {
                        await tx.aiDailyUsage.update({
                            where: { userId_day: { userId: user.id, day } },
                            data: { count: { increment: 1 } },
                        });
                    } else {
                        await tx.aiDailyUsage.create({ data: { userId: user.id, day, count: count + 1 } });
                    }
                    await tx.aiUsage.create({ data: { userId: user.id, kind } });
                    return true;
                }, { maxWait: 10000, timeout: 30000 }));
                break;
            } catch (error) {
                const code = (error as { code?: string })?.code;
                const message = error instanceof Error ? error.message : String(error);
                if (attempt >= 2 || (code !== 'P2034' && code !== 'P1008' && !/database is locked|SQLITE_BUSY/i.test(message))) throw error;
            }
        }
        if (reserved) return null;
        logger.info({ userId: user.id, kind, limit }, 'AI daily limit reached');
        return { code: 'AI_DAILY_LIMIT_EXCEEDED', details: { limit } };
    } catch (error) {
        logger.error({ error, userId: user.id, kind }, 'Failed to reserve AI daily usage');
        return null;
    }
}

/**
 * 每日次数上限：普通用户超出管理员设置的每日次数时拒绝，管理员和未设上限时不限制。
 * 读取配置或统计失败时放行，避免统计问题影响正常使用。
 */
export async function checkDailyLimit(scope: AiAuthorizeScope): Promise<AiAccessDenial | null> {
    try {
        const limit = getAppConfig().aiDailyLimit ?? 0;
        if (limit > 0 && scope.role !== 'admin' && await countTodayAiUsage(scope.userId) >= limit) {
            logger.info({ userId: scope.userId, kind: scope.kind, limit }, 'AI daily limit reached');
            return { code: 'AI_DAILY_LIMIT_EXCEEDED', details: { limit } };
        }
    } catch (error) {
        logger.error({ error, userId: scope.userId, kind: scope.kind }, 'Failed to check AI daily limit');
    }
    return null;
}

import "server-only";

import { getAppConfig, getAppTimeZone } from "@/lib/config";
import { getDayRange } from "@/lib/date-time";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { AiAccessDenial, AiAuthorizeScope } from "./account";

const logger = createLogger('ai:daily-limit');

/** 用户在应用时区的今天已发起的 AI 调用次数 */
export async function countTodayAiUsage(userId: string, now = new Date()): Promise<number> {
    const { start, end } = getDayRange(now, getAppTimeZone());
    return prisma.aiUsage.count({ where: { userId, createdAt: { gte: start, lt: end } } });
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

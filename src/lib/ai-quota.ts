import type { NextResponse } from "next/server";
import { createErrorResponse, ErrorCode } from "@/lib/api-errors";
import type { ApiErrorResponse } from "@/lib/api-errors";
import { getAppConfig, getAppTimeZone } from "@/lib/config";
import { getDayRange } from "@/lib/date-time";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger('ai-quota');

/** 计入额度的用户操作；后台自动进行的掌握概率评估不计入 */
export const AI_USAGE_KINDS = ['analyze', 'split', 'reanswer', 'practice', 'grade', 'figure', 'latex', 'geogebra', 'animation', 'exam', 'retag'] as const;
export type AiUsageKind = typeof AI_USAGE_KINDS[number];

interface QuotaUser {
    id: string;
    role?: string | null;
}

/** 用户在应用时区的今天已发起的 AI 调用次数 */
export async function countTodayAiUsage(userId: string, now = new Date()): Promise<number> {
    const { start, end } = getDayRange(now, getAppTimeZone());
    return prisma.aiUsage.count({ where: { userId, createdAt: { gte: start, lt: end } } });
}

/**
 * 发起 AI 调用前检查并记录额度：超出每日上限时返回 429 响应，路由直接返回它；
 * 否则记录一次调用并返回 null。管理员不受限制，但同样记录用量。
 * 读取配置或记录失败时不阻止调用，避免统计问题影响正常使用。
 */
export async function consumeAiQuota(user: QuotaUser, kind: AiUsageKind): Promise<NextResponse<ApiErrorResponse> | null> {
    try {
        const limit = getAppConfig().aiDailyLimit ?? 0;
        if (limit > 0 && user.role !== 'admin' && await countTodayAiUsage(user.id) >= limit) {
            logger.info({ userId: user.id, kind, limit }, 'AI daily limit reached');
            return createErrorResponse(ErrorCode.AI_DAILY_LIMIT_EXCEEDED, 429, ErrorCode.AI_DAILY_LIMIT_EXCEEDED, { limit });
        }
        await prisma.aiUsage.create({ data: { userId: user.id, kind } });
    } catch (error) {
        logger.error({ error, userId: user.id, kind }, 'Failed to check AI quota');
    }
    return null;
}

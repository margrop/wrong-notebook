import type { NextResponse } from "next/server";
import { createErrorResponse, ErrorCode } from "@/lib/api-errors";
import type { ApiErrorResponse } from "@/lib/api-errors";
import { hasAiDataConsent } from "@/lib/ai-consent-store";
import type { ConsentUser } from "@/lib/ai-consent-store";
import { getAppConfig, getAppTimeZone } from "@/lib/config";
import { getDayRange } from "@/lib/date-time";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger('ai-quota');

/** 计入额度的用户操作；后台自动进行的掌握概率评估不计入 */
export const AI_USAGE_KINDS = ['analyze', 'split', 'reanswer', 'practice', 'grade', 'figure', 'latex', 'geogebra', 'animation', 'exam', 'retag'] as const;
export type AiUsageKind = typeof AI_USAGE_KINDS[number];

interface QuotaUser extends ConsentUser {
    role?: string | null;
}

/** consumeAiQuota 返回的拒绝响应对应的错误码（每日上限或未授权），供后台任务记录失败原因 */
export async function quotaRejectionCode(rejection: Response): Promise<'AI_DAILY_LIMIT_EXCEEDED' | 'AI_CONSENT_REQUIRED'> {
    const body = await rejection.clone().json().catch(() => null) as { code?: unknown } | null;
    return body?.code === ErrorCode.AI_CONSENT_REQUIRED ? 'AI_CONSENT_REQUIRED' : 'AI_DAILY_LIMIT_EXCEEDED';
}

/** 用户在应用时区的今天已发起的 AI 调用次数 */
export async function countTodayAiUsage(userId: string, now = new Date()): Promise<number> {
    const { start, end } = getDayRange(now, getAppTimeZone());
    return prisma.aiUsage.count({ where: { userId, createdAt: { gte: start, lt: end } } });
}

/**
 * 发起 AI 调用前检查授权与额度：
 * - 用户尚未同意 AI 数据授权时返回 403（AI_CONSENT_REQUIRED），不向 AI 服务商发送任何数据；
 * - 超出每日上限时返回 429；
 * 路由直接返回该响应，否则记录一次调用并返回 null。管理员不受次数限制，但同样记录用量、同样需要授权。
 * 授权检查失败（如数据库不可用）时拒绝调用；读取额度配置或记录用量失败时不阻止调用，避免统计问题影响正常使用。
 */
export async function consumeAiQuota(user: QuotaUser, kind: AiUsageKind): Promise<NextResponse<ApiErrorResponse> | null> {
    let consented = false;
    try {
        consented = await hasAiDataConsent(user);
    } catch (error) {
        logger.error({ error, userId: user.id, kind }, 'Failed to check AI data consent');
    }
    if (!consented) {
        logger.info({ userId: user.id, kind }, 'AI call blocked: data consent not given');
        return createErrorResponse(ErrorCode.AI_CONSENT_REQUIRED, 403, ErrorCode.AI_CONSENT_REQUIRED);
    }
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

import type { NextResponse } from "next/server";
import { createErrorResponse, ErrorCode } from "@/lib/api-errors";
import type { ApiErrorResponse } from "@/lib/api-errors";
import { hasAiDataConsent } from "@/lib/ai-consent-store";
import type { ConsentUser } from "@/lib/ai-consent-store";
import { getAiAccountProvider } from "@/lib/ai/account-provider";
import type { AiAccessDenial } from "@/lib/ai/account";
import { isAiRejectionCode } from "@/lib/ai-limit-message";
import type { AiRejectionCode } from "@/lib/ai-limit-message";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger('ai-quota');

/** 计入额度的用户操作；后台自动进行的掌握概率评估不计入 */
export const AI_USAGE_KINDS = ['analyze', 'split', 'reanswer', 'practice', 'grade', 'figure', 'latex', 'geogebra', 'animation', 'exam', 'retag'] as const;
export type AiUsageKind = typeof AI_USAGE_KINDS[number];

interface QuotaUser extends ConsentUser {
    role?: string | null;
}

/** consumeAiQuota 返回的拒绝响应对应的错误码（额度用完或未授权），供后台任务记录失败原因 */
export async function quotaRejectionCode(rejection: Response): Promise<AiRejectionCode> {
    const body = await rejection.clone().json().catch(() => null) as { code?: unknown } | null;
    return isAiRejectionCode(body?.code) ? body.code : 'AI_DAILY_LIMIT_EXCEEDED';
}

export { countTodayAiUsage } from "@/lib/ai/daily-limit";

/**
 * 发起 AI 调用前检查授权与额度：
 * - 用户尚未同意 AI 数据授权时返回 403（AI_CONSENT_REQUIRED），不向 AI 服务商发送任何数据；
 * - AI 账户实现拒绝时（默认实现为超出每日上限）返回 429；
 * 路由直接返回该响应，否则记录一次调用并返回 null。默认实现下管理员不受次数限制，但同样记录用量、同样需要授权。
 * 授权检查失败（如数据库不可用）时拒绝调用；额度检查出错或记录用量失败时不阻止调用，避免统计问题影响正常使用。
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
    let denial: AiAccessDenial | null = null;
    try {
        denial = await getAiAccountProvider().authorize({ userId: user.id, kind, role: user.role });
    } catch (error) {
        logger.error({ error, userId: user.id, kind }, 'Failed to check AI quota');
    }
    if (denial) {
        return createErrorResponse(denial.code, 429, ErrorCode[denial.code], denial.details);
    }
    try {
        await prisma.aiUsage.create({ data: { userId: user.id, kind } });
    } catch (error) {
        logger.error({ error, userId: user.id, kind }, 'Failed to record AI usage');
    }
    return null;
}

import { NextResponse } from "next/server";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const logger = createLogger('api:user:ai-consent');

/** 保存授权状态并返回最新的授权时间（未授权为 null） */
async function setConsent(userId: string, consentAt: Date | null) {
    const updated = await prisma.user.update({
        where: { id: userId },
        data: { aiDataConsentAt: consentAt },
        select: { aiDataConsentAt: true },
    });
    logger.info({ userId, consented: consentAt !== null }, 'AI data consent updated');
    return NextResponse.json({ aiDataConsentAt: updated.aiDataConsentAt });
}

/**
 * POST /api/user/ai-consent
 * 当前用户同意把题目、图片、答案等任务所需数据发送给管理员配置的第三方 AI 服务商
 */
export const POST = withUser(async (_req: Request, { user }: AuthenticatedContext) => setConsent(user.id, new Date()));

/**
 * DELETE /api/user/ai-consent
 * 撤回授权：之后的 AI 请求在发送前被拒绝，已发送给服务商的数据不受影响
 */
export const DELETE = withUser(async (_req: Request, { user }: AuthenticatedContext) => setConsent(user.id, null));

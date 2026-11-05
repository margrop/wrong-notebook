import "server-only";

import { prisma } from "@/lib/prisma";

export interface ConsentUser {
    id: string;
    /** 已查出的授权时间；未传入（undefined）时从数据库读取 */
    aiDataConsentAt?: Date | null;
}

/** 用户是否已同意把题目等数据发送给第三方 AI 服务商 */
export async function hasAiDataConsent(user: ConsentUser): Promise<boolean> {
    if (user.aiDataConsentAt !== undefined) return user.aiDataConsentAt !== null;
    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { aiDataConsentAt: true } });
    return !!row?.aiDataConsentAt;
}

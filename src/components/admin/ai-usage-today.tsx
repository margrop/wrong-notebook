"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { formatTokenCount } from "@/lib/format-token-count";
import type { AdminUser } from "@/types/api";

interface AiUsageTodayProps {
    user: Pick<AdminUser, "aiUsageToday" | "aiTokensToday">;
}

/** 管理员用户列表中的今日 AI 用量：调用次数与输入、输出 token */
export function AiUsageToday({ user }: AiUsageTodayProps) {
    const { t, language } = useLanguage();
    const tokens = t.admin.aiTokensDetail
        .replace("{input}", formatTokenCount(user.aiTokensToday.input, language))
        .replace("{output}", formatTokenCount(user.aiTokensToday.output, language));
    return (
        <>
            {t.admin.aiUsageToday}: {user.aiUsageToday} | {t.admin.aiTokensToday}: {tokens}
        </>
    );
}

"use client";

import { useLanguage } from "@/contexts/LanguageContext";

interface ProviderErrorDetailProps {
    detail?: string;
}

/** 测试连接、试听失败时显示服务商的原始报错，便于排查（如额度用完、模型或音色不存在） */
export function ProviderErrorDetail({ detail }: ProviderErrorDetailProps) {
    const { t } = useLanguage();
    if (!detail) return null;
    return (
        <p className="mt-1 rounded bg-background/60 px-2 py-1 font-mono text-[11px] leading-relaxed text-red-700 break-all select-text">
            <span className="font-sans text-muted-foreground">{t.settings.ai.providerErrorDetail}</span>
            {detail}
        </p>
    );
}

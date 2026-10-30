"use client";

import { ExternalLink } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { getProviderDocs } from "@/lib/ai/provider-docs";
import type { AppConfig } from "@/types/api";

interface ProviderDocLinksProps {
    provider: AppConfig['aiProvider'];
}

/** 当前 AI 提供商的官方接入文档链接；有国内站和国际站时两个都列出 */
export function ProviderDocLinks({ provider }: ProviderDocLinksProps) {
    const { t } = useLanguage();
    const texts = t.settings.ai.providerDocs;
    const docs = getProviderDocs(provider);
    if (!docs) return null;
    const links = [
        docs.cn && { href: docs.cn, label: docs.intl ? texts.cn : texts.official },
        docs.intl && { href: docs.intl, label: docs.cn ? texts.intl : texts.official },
    ].filter((link): link is { href: string; label: string } => !!link);

    return (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{texts.title}</span>
            {links.map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                    {link.label}
                    <ExternalLink className="h-3 w-3" />
                </a>
            ))}
        </p>
    );
}

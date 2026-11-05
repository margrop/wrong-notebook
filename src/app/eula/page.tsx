"use client";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { useLanguage } from "@/contexts/LanguageContext";
import { EULA_TEXT } from "@/lib/eula/text";
import { usePageTitle } from "@/lib/page-title";

/** 使用协议公开页：登录与否都能访问（/initialize 未登录时要能打开） */
export default function EulaPage() {
    const { t, language } = useLanguage();
    usePageTitle(t.eula.pageTitle);
    return (
        <main className="mx-auto max-w-3xl px-4 py-8 md:py-12">
            <MarkdownRenderer content={language === "en" ? EULA_TEXT.en : EULA_TEXT.zh} />
        </main>
    );
}

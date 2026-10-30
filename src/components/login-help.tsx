"use client";

import Link from "next/link";
import { ExternalLink, HelpCircle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { PROJECT_REPO_URL } from "@/lib/constants/project";
import { DEFAULT_ADMIN_EMAIL } from "@/lib/default-admin";

interface LoginHelpProps {
    /** 是否开放注册；尚未取得状态时为 null，此时不显示注册相关文字 */
    allowRegistration: boolean | null;
}

/**
 * 登录页底部的帮助：注册入口（关闭注册时改为联系管理员）与首次使用指引。
 * 指引对所有访问者相同、不显示密码，也不透露实例是否已修改默认密码
 */
export function LoginHelp({ allowRegistration }: LoginHelpProps) {
    const { t, language } = useLanguage();
    const texts = t.auth.login;
    const docsUrl = `${PROJECT_REPO_URL}/wiki/${language === "en" ? "FAQ-en" : "FAQ"}`;
    const [accountBefore, accountAfter] = texts.firstUseAccount.split("{email}");

    return (
        <div className="space-y-3 text-sm text-muted-foreground">
            {allowRegistration === true && (
                <p className="text-center">
                    {texts.noAccount}
                    <Link href="/register" className="text-primary hover:underline">
                        {texts.registerNow}
                    </Link>
                </p>
            )}
            {allowRegistration === false && <p className="text-center">{texts.registrationClosed}</p>}

            <details className="group rounded-lg border bg-muted/30 px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 font-medium text-foreground">
                    <HelpCircle className="h-4 w-4" />
                    {texts.firstUseTitle}
                </summary>
                <div className="mt-2 space-y-2">
                    <p>
                        {accountBefore}
                        <code className="rounded bg-muted px-1 py-0.5 text-foreground">{DEFAULT_ADMIN_EMAIL}</code>
                        {accountAfter}
                    </p>
                    <p>{texts.firstUseNext}</p>
                    <a href={docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        {texts.firstUseDocs}
                        <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                </div>
            </details>
        </div>
    );
}

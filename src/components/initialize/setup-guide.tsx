"use client";

import { ExternalLink, KeyRound } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { PROJECT_REPO_URL } from "@/lib/constants/project";

/** 尚未创建管理员时的说明：到哪里找一次性初始化链接 */
export function SetupGuide() {
    const { t, language } = useLanguage();
    const texts = t.auth.setupGuide;
    const docsUrl = `${PROJECT_REPO_URL}/wiki/${language === "en" ? "Deployment-en" : "Deployment"}`;

    return (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="flex items-center gap-2 font-medium">
                <KeyRound className="h-4 w-4 shrink-0" />
                {texts.title}
            </p>
            <p>{texts.intro}</p>
            <ul className="list-disc space-y-1 pl-5">
                <li>{texts.desktop}</li>
                <li>{texts.docker}</li>
                <li>{texts.npm}</li>
                <li>{texts.tokenFile}</li>
            </ul>
            <a href={docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
                {texts.docs}
                <ExternalLink className="h-3.5 w-3.5" />
            </a>
        </div>
    );
}

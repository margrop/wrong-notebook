"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Info, MessageSquareText, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GithubIcon } from "@/components/icons/github-icon";
import { AndroidAppSetting } from "@/components/settings/android-app-setting";
import { useLanguage } from "@/contexts/LanguageContext";
import { PROJECT_REPO_URL } from "@/lib/constants/project";

/** 关于：版本号、安卓 App 与项目链接 */
export function AboutSettings() {
    const { t } = useLanguage();
    const [version, setVersion] = useState("");

    useEffect(() => {
        fetch("/api/version")
            .then((res) => res.json())
            .then((data) => setVersion(data.version))
            .catch(() => {});
    }, []);

    const links = [
        { href: PROJECT_REPO_URL, icon: GithubIcon, label: t.settings?.about?.github || "GitHub Repository" },
        { href: `${PROJECT_REPO_URL}/releases`, icon: ScrollText, label: t.settings?.about?.releaseNotes || "Release Notes" },
        { href: `${PROJECT_REPO_URL}/issues`, icon: MessageSquareText, label: t.settings?.about?.feedback || "Feedback" },
    ];

    return (
        <div className="flex flex-col items-center justify-center space-y-6 py-8 text-center bg-muted/30 rounded-lg border">
            <div className="space-y-2">
                <h3 className="text-2xl font-bold">{t.app?.title || "Smart Error Notebook"}</h3>
                <p className="text-muted-foreground">
                    {t.settings?.about?.desc || "AI-powered learning assistant"}
                </p>
            </div>

            <div className="flex items-center space-x-2 text-sm text-muted-foreground border px-4 py-2 rounded-full bg-background">
                <Info className="h-4 w-4" />
                <span>{t.settings?.about?.version || "Version"}: v{version || "unknown"}</span>
            </div>

            <AndroidAppSetting />

            <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-4 w-full sm:w-auto px-4 sm:px-0">
                {links.map(({ href, icon: Icon, label }) => (
                    <Button key={href} variant="outline" asChild className="gap-2 w-full sm:w-auto">
                        <a href={href} target="_blank" rel="noopener noreferrer">
                            <Icon className="h-4 w-4" />
                            {label}
                            <ExternalLink className="h-3 w-3 ml-1 opacity-50" />
                        </a>
                    </Button>
                ))}
            </div>

            <p className="text-xs text-muted-foreground mt-8">
                {t.settings?.about?.copyright || "© 2026 margrop · Based on wttwins/wrong-notebook · MIT License"}
            </p>
        </div>
    );
}

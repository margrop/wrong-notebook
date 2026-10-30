"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { InitializeForm } from "@/components/initialize/initialize-form";
import { SetupGuide } from "@/components/initialize/setup-guide";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { frontendLogger } from "@/lib/frontend-logger";
import { usePageTitle } from "@/lib/page-title";

/** 全新安装时打开一次性初始化链接（/initialize?token=…）创建第一个管理员 */
function InitializeContent() {
    const { t } = useLanguage();
    const texts = t.auth.initialize;
    const token = useSearchParams().get("token") || "";
    const [initialized, setInitialized] = useState<boolean | null>(null);

    useEffect(() => {
        fetch("/api/register/status")
            .then((res) => res.json())
            .then((data: { initialized?: boolean }) => setInitialized(data.initialized === true))
            .catch((error) => {
                frontendLogger.error('[Initialize]', 'Failed to check initialization status', { error });
                // 状态未知时仍显示表单，由服务端校验
                setInitialized(false);
            });
    }, []);

    if (initialized === null) {
        return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
    }
    if (initialized) {
        return (
            <div className="space-y-4 py-2 text-center">
                <p className="text-muted-foreground">{texts.alreadyInitialized}</p>
                <Link href="/login" className="text-primary hover:underline">{texts.goLogin}</Link>
            </div>
        );
    }
    if (!token) return <SetupGuide />;
    return <InitializeForm token={token} onAlreadyInitialized={() => setInitialized(true)} />;
}

export default function InitializePage() {
    const { t } = useLanguage();
    usePageTitle(t.auth.initialize.pageTitle);

    return (
        <AuthShell>
            <Card className="w-full rounded-2xl border-0 shadow-xl shadow-indigo-500/5 ring-1 ring-border">
                <CardHeader>
                    <CardTitle className="text-2xl text-center">{t.auth.initialize.title}</CardTitle>
                </CardHeader>
                <CardContent>
                    <Suspense fallback={<div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
                        <InitializeContent />
                    </Suspense>
                </CardContent>
            </Card>
        </AuthShell>
    );
}

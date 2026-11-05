"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { frontendLogger } from "@/lib/frontend-logger";
import { trackError } from "@/lib/telemetry/client";

interface ErrorPageProps {
    error: Error & { digest?: string };
    reset: () => void;
}

/** 路由段渲染出错时的兜底页面：记录日志、匿名上报（遥测开启时），并提供重试 */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
    const { t } = useLanguage();

    useEffect(() => {
        frontendLogger.error("[ErrorBoundary]", error.message || "Render error", { error, digest: error.digest });
        trackError({ kind: "boundary", scope: "app.boundary", error });
    }, [error]);

    return (
        <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <h1 className="text-xl font-semibold">{t.errorBoundary.title}</h1>
            <p className="text-sm text-muted-foreground">{t.errorBoundary.desc}</p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Button onClick={reset}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {t.errorBoundary.retry}
                </Button>
                <Button variant="outline" asChild>
                    <Link href="/">{t.errorBoundary.home}</Link>
                </Button>
            </div>
        </main>
    );
}

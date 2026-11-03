"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface StatsEmptyProps {
    icon: LucideIcon;
    title: string;
    description?: string;
    /** 可选的操作按钮或链接 */
    action?: ReactNode;
    className?: string;
}

/** 统计中心空状态：图标 + 标题 + 说明 + 可选操作 */
export function StatsEmpty({ icon: Icon, title, description, action, className }: StatsEmptyProps) {
    return (
        <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/50 px-6 py-14 text-center", className)}>
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <Icon className="h-7 w-7" />
            </div>
            <p className="font-medium">{title}</p>
            {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
}

interface StatsErrorProps {
    className?: string;
    onRetry: () => void;
}

/** 统计中心加载失败提示：错误说明 + 重试按钮 */
export function StatsError({ className, onRetry }: StatsErrorProps) {
    const { t } = useLanguage();
    return (
        <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/50 px-6 py-14 text-center", className)}>
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertCircle className="h-7 w-7" />
            </div>
            <p className="font-medium">{t.statsState?.errorTitle || "Failed to load statistics"}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {t.statsState?.errorDesc || "Please check your network and try again."}
            </p>
            <div className="mt-5">
                <Button variant="outline" size="sm" onClick={onRetry}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {t.statsState?.retry || "Retry"}
                </Button>
            </div>
        </div>
    );
}

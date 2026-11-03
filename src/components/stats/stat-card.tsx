"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface StatCardProps {
    title: string;
    value: string | number;
    description?: string;
    icon: LucideIcon;
    /** 设置后整张卡片变为链接，支持 hover 与键盘聚焦 */
    href?: string;
    "aria-label"?: string;
}

/** 概览数字卡片：标题 + 图标 + 数值 + 说明；带 href 时整卡可点击跳转 */
export function StatCard({ title, value, description, icon: Icon, href, ...rest }: StatCardProps) {
    const content = (
        <>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{value}</div>
                {description && (
                    <p className="text-xs text-muted-foreground">{description}</p>
                )}
            </CardContent>
        </>
    );

    if (href) {
        return (
            <Link
                href={href}
                aria-label={rest["aria-label"] ?? title}
                className="block rounded-2xl outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
            >
                <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
                    {content}
                </Card>
            </Link>
        );
    }

    return <Card>{content}</Card>;
}

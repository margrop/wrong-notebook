"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { LogOut, Shield } from "lucide-react";
import { EulaUpgradeDialog } from "@/components/eula/eula-upgrade-dialog";
import { ImportTasksIndicator } from "@/components/import-tasks/import-tasks-indicator";
import { SettingsDialog } from "@/components/settings-dialog";
import { TelemetryNoticeBanner } from "@/components/telemetry-notice-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { APP_BRAND, NAV_ITEMS, isBarePath } from "@/lib/app-navigation";
import { useEulaGate } from "@/lib/hooks/use-eula-gate";
import { usePageTelemetry } from "@/lib/hooks/use-page-telemetry";
import { useSetupRedirect } from "@/lib/hooks/use-setup-redirect";
import { cn } from "@/lib/utils";

/** 全局导航外壳：桌面端顶部导航栏，移动端顶部标题栏 + 底部标签栏 */
export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname() || "/";
    const { t } = useLanguage();
    const { data: session, status } = useSession();
    const isAdmin = session?.user?.role === "admin";
    const isBare = isBarePath(pathname);
    useSetupRedirect(isAdmin && !isBare);
    usePageTelemetry(pathname, status === "authenticated");
    // 协议升级后管理员必须重新同意；/setup 等无导航页面同样拦截，普通用户不受影响
    const eulaGate = useEulaGate(isAdmin && status === "authenticated");
    const gate = eulaGate.pending && eulaGate.status
        ? <EulaUpgradeDialog status={eulaGate.status} onAccept={eulaGate.accept} />
        : null;

    if (isBare || status === "unauthenticated") {
        return <>{children}{gate}</>;
    }

    const userName = session?.user?.name || session?.user?.email || "";

    return (
        <div className="min-h-screen">
            <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-md supports-[backdrop-filter]:bg-card/70 print:hidden">
                <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:h-16 md:px-8">
                    <Link href="/" className="flex shrink-0 items-center gap-2">
                        <Image src={APP_BRAND.iconSrc} alt="" width={32} height={32} className="rounded-lg" priority unoptimized />
                        {/* 手机上只显示图标，给「识别任务」入口留出位置 */}
                        <span className="hidden text-base font-semibold tracking-tight sm:inline">{t.pageTitle.base}</span>
                    </Link>

                    <nav className="ml-4 hidden items-center gap-1 md:flex">
                        {NAV_ITEMS.map((item) => {
                            const active = item.match(pathname);
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.key}
                                    href={item.href}
                                    className={cn(
                                        "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                        active
                                            ? "bg-accent text-accent-foreground"
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                    aria-current={active ? "page" : undefined}
                                >
                                    <Icon className="h-4 w-4" />
                                    {t.nav[item.key]}
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="ml-auto flex items-center gap-1">
                        {userName && (
                            <span className="mr-2 hidden max-w-40 items-center gap-2 truncate text-sm text-muted-foreground lg:flex">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                                    {userName.slice(0, 1).toUpperCase()}
                                </span>
                                <span className="truncate">{userName}</span>
                            </span>
                        )}
                        {isAdmin && (
                            <Link href="/admin" title={t.nav.admin}>
                                <Button variant="ghost" size="icon" className="rounded-full">
                                    <Shield className="h-5 w-5" />
                                    <span className="sr-only">{t.nav.admin}</span>
                                </Button>
                            </Link>
                        )}
                        <ImportTasksIndicator className="mr-1" />
                        <ThemeToggle />
                        <SettingsDialog />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-full text-muted-foreground hover:text-destructive"
                            onClick={() => signOut({ callbackUrl: "/login" })}
                            title={t.app.logout}
                        >
                            <LogOut className="h-5 w-5" />
                        </Button>
                    </div>
                </div>
            </header>
            <TelemetryNoticeBanner enabled={isAdmin && status === "authenticated" && !eulaGate.pending} />

            <div className="pb-20 md:pb-0">{children}</div>
            {gate}

            <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-card/90 backdrop-blur-md md:hidden print:hidden">
                <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${NAV_ITEMS.length}, minmax(0, 1fr))` }}>
                    {NAV_ITEMS.map((item) => {
                        const active = item.match(pathname);
                        const Icon = item.icon;
                        return (
                            <Link
                                key={item.key}
                                href={item.href}
                                className={cn(
                                    "flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                                    active ? "text-primary" : "text-muted-foreground"
                                )}
                                aria-current={active ? "page" : undefined}
                            >
                                <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-accent")}>
                                    <Icon className="h-5 w-5" />
                                </span>
                                {t.nav[item.key]}
                            </Link>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}

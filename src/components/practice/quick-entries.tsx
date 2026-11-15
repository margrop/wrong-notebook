"use client";

import Link from "next/link";
import { CalendarCheck, FileText, LibraryBig } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface QuickEntry {
    href: string;
    icon: LucideIcon;
    label: string;
    description: string;
}

/** 手机底部导航收敛为 4 项后，复习/试卷/真题库的固定入口（桌面端顶部导航仍直接可达） */
export function PracticeQuickEntries() {
    const { t } = useLanguage();
    const entries: QuickEntry[] = [
        { href: "/review", icon: CalendarCheck, label: t.nav.review, description: t.review.desc },
        { href: "/exams", icon: FileText, label: t.nav.exams, description: t.exam.subtitle },
        { href: "/banks", icon: LibraryBig, label: t.nav.banks, description: t.banks.subtitle || "" },
    ];

    return (
        <div className="grid gap-3 md:hidden">
            {entries.map((entry) => (
                <Link
                    key={entry.href}
                    href={entry.href}
                    className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 transition-colors hover:bg-accent"
                >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <entry.icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-sm font-medium">{entry.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{entry.description}</span>
                    </span>
                </Link>
            ))}
        </div>
    );
}

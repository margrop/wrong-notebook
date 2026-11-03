import type { LucideIcon } from "lucide-react";
import { BarChart3, BookOpen, CalendarCheck, FileText, PlusCircle } from "lucide-react";
import type { translations } from "@/lib/translations";

/** 导航项 key：对应 translations 中 t.nav 的翻译 key */
export type NavKey = keyof typeof translations.en.nav;

export interface NavItem {
    key: NavKey;
    href: string;
    icon: LucideIcon;
    match: (pathname: string) => boolean;
}

/** 登录、注册与打印页不显示导航 */
export const BARE_PATHS: RegExp[] = [/^\/login/, /^\/register/, /^\/setup/, /^\/print-preview/, /^\/exams\/[^/]+\/print/];

/** 底部导航与顶部导航共用的导航项列表 */
export const NAV_ITEMS: NavItem[] = [
    { key: "home", href: "/", icon: PlusCircle, match: (p) => p === "/" },
    {
        key: "notebooks",
        href: "/notebooks",
        icon: BookOpen,
        match: (p) => p.startsWith("/notebooks") || p.startsWith("/error-items") || p.startsWith("/practice"),
    },
    { key: "review", href: "/review", icon: CalendarCheck, match: (p) => p.startsWith("/review") },
    { key: "stats", href: "/stats", icon: BarChart3, match: (p) => p.startsWith("/stats") || p.startsWith("/tags") },
    { key: "exams", href: "/exams", icon: FileText, match: (p) => p.startsWith("/exams") },
];

/** 品牌配置：fork 项目可替换图标路径 */
export const APP_BRAND = { iconSrc: "/icons/icon.png" } as const;

/** 当前路径是否不显示导航 */
export function isBarePath(pathname: string): boolean {
    return BARE_PATHS.some((pattern) => pattern.test(pathname));
}

/** 返回第一个 match 的导航项 key；无匹配返回 null */
export function findActiveNavKey(pathname: string): NavKey | null {
    const item = NAV_ITEMS.find((nav) => nav.match(pathname));
    return item ? item.key : null;
}

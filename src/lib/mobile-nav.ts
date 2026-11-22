/** 手机底部导航栏第 4 个入口。 */
export const MOBILE_NAV_FOURTH_OPTIONS = ["exams", "review"] as const;

export type MobileNavFourth = (typeof MOBILE_NAV_FOURTH_OPTIONS)[number];

/** 新账号默认把第 4 个入口指向试卷。 */
export const DEFAULT_MOBILE_NAV_FOURTH: MobileNavFourth = "exams";

export function isMobileNavFourth(value: unknown): value is MobileNavFourth {
    return typeof value === "string" && (MOBILE_NAV_FOURTH_OPTIONS as readonly string[]).includes(value);
}

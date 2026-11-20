/**
 * 卷别相关常量配置
 */

/**
 * paperLevel 字段允许的最大长度。
 * 存的是 PaperGroup.id：迁移（20261031195209_add_paper_group）用 32 位 hex 生成旧用户的
 * 系统分组 id，Prisma cuid 为 25 位，均需通过校验，取 64 留出余量。
 */
export const MAX_PAPER_LEVEL_LENGTH = 64;

/** 未评级不自动分组；1～3 星默认 A 卷，4～5 星默认 B 卷。 */
export function getDefaultPaperLevelKey(stars: number | null | undefined): "a" | "b" | null {
    if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) return null;
    return stars <= 3 ? "a" : "b";
}

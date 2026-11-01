import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient | typeof prisma;

function getClient(client?: DbClient): DbClient {
    return client ?? prisma;
}

/**
 * 按难度星级返回当前用户默认分组 id：1～3 星 → key='a'，4～5 星 → key='b'；未评级或默认分组不存在时返回 null。
 */
export async function getDefaultPaperLevelGroupId(
    userId: string,
    difficultyStars: number | null | undefined,
    client?: DbClient,
): Promise<string | null> {
    if (typeof difficultyStars !== "number" || !Number.isInteger(difficultyStars)
        || difficultyStars < 1 || difficultyStars > 5) {
        return null;
    }
    const key = difficultyStars <= 3 ? "a" : "b";
    const db = getClient(client);
    const group = await db.paperGroup.findFirst({
        where: { userId, key, isActive: true },
        select: { id: true },
    });
    return group?.id ?? null;
}

/**
 * 确保用户存在默认系统分组（a/b/other），返回 id 映射。用于新用户首次创建错题或旧数据补分组。
 */
export async function ensureDefaultPaperGroups(userId: string, client?: DbClient): Promise<Record<string, string>> {
    const db = getClient(client);
    const existing = await db.paperGroup.findMany({
        where: { userId, key: { in: ["a", "b", "other"] } },
        select: { id: true, key: true },
    });
    const map: Record<string, string> = {};
    for (const g of existing) {
        if (g.key) map[g.key] = g.id;
    }
    const defaults: Array<{ key: string; name: string; order: number }> = [
        { key: "a", name: "A卷", order: 0 },
        { key: "b", name: "B卷", order: 1 },
        { key: "other", name: "其他", order: 2 },
    ];
    for (const d of defaults) {
        if (!map[d.key]) {
            const created = await db.paperGroup.create({
                data: { userId, key: d.key, name: d.name, order: d.order },
                select: { id: true },
            });
            map[d.key] = created.id;
        }
    }
    return map;
}

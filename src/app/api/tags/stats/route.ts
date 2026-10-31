import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:tags:stats');

export const dynamic = "force-dynamic";


/**
 * GET /api/tags/stats
 * 获取当前用户的标签使用频率统计
 */
export async function GET() {
    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        // 按标签关系统计（knowledgePoints 已弃用，只保留双写）；只计当前用户自己的错题
        const [total, tags] = await Promise.all([
            prisma.errorItem.count({ where: { userId: user.id } }),
            prisma.knowledgeTag.findMany({
                where: { errorItems: { some: { userId: user.id } } },
                select: {
                    name: true,
                    _count: { select: { errorItems: { where: { userId: user.id } } } },
                },
            }),
        ]);

        // 不同学科或层级可能有同名标签，按名称合并
        const tagStats: Record<string, number> = {};
        for (const tag of tags) {
            tagStats[tag.name] = (tagStats[tag.name] || 0) + tag._count.errorItems;
        }

        // 转换为数组并按使用次数排序
        const sortedStats = Object.entries(tagStats)
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);

        return NextResponse.json({
            stats: sortedStats,
            total,
            uniqueTags: sortedStats.length,
        });
    } catch (error) {
        logger.error({ error }, 'Error getting tag stats');
        return NextResponse.json(
            { message: "Failed to get tag statistics" },
            { status: 500 }
        );
    }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import type { TagStats } from "@/types/api";

const logger = createLogger('api:tags:stats');

export const dynamic = "force-dynamic";


/**
 * GET /api/tags/stats?tagSet=<体系>
 * 获取当前用户的标签使用频率统计，按「标签体系 + 学科 + 标签名」分组；
 * 传入 tagSet 时只统计该体系的标签
 */
async function handleGet(request: Request, { user }: AuthenticatedContext) {
    const tagSetParam = new URL(request.url).searchParams.get('tagSet')?.trim();

    // 按标签关系统计（knowledgePoints 已弃用，只保留双写）；只计当前用户自己的错题
    const [total, tags] = await Promise.all([
        prisma.errorItem.count({ where: { userId: user.id } }),
        prisma.knowledgeTag.findMany({
            where: {
                errorItems: { some: { userId: user.id } },
                ...(tagSetParam ? { tagSet: tagSetParam } : {}),
            },
            select: {
                id: true,
                name: true,
                subject: true,
                tagSet: true,
                _count: { select: { errorItems: { where: { userId: user.id } } } },
            },
        }),
    ]);

    // 同一体系、同一学科下不同年级可能有同名标签，按名称合并；不同体系或学科分别计数
    const grouped = new Map<string, TagStats>();
    for (const tag of tags) {
        const key = JSON.stringify([tag.tagSet, tag.subject, tag.name]);
        const entry = grouped.get(key);
        if (entry) {
            entry.count += tag._count.errorItems;
            entry.tagIds.push(tag.id);
        } else {
            grouped.set(key, {
                tag: tag.name,
                subject: tag.subject,
                tagSet: tag.tagSet,
                count: tag._count.errorItems,
                tagIds: [tag.id],
            });
        }
    }

    // 按使用次数降序，次数相同时按名称排序保证结果稳定
    const sortedStats = [...grouped.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));

    return NextResponse.json({
        stats: sortedStats,
        total,
        uniqueTags: sortedStats.length,
    });
}

export const GET = withUser(async (req, ctx) => {
    try {
        return await handleGet(req, ctx);
    } catch (error) {
        logger.error({ error }, 'Error getting tag stats');
        return NextResponse.json(
            { message: "Failed to get tag statistics" },
            { status: 500 }
        );
    }
});

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAppTimeZone } from "@/lib/config";
import { internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getMasteryThreshold } from "@/lib/mastery";
import { masteryStatusWhere } from "@/lib/mastery-status";
import { normalizeMistakeStatus } from "@/lib/question/mistake-status";
import { parseStatsRange, resolveStatsRange } from "@/lib/stats/stats-range";
import { resolveStatsSubjectId } from "@/lib/stats/stats-filter";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:analytics');

export const GET = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    const userId = user.id;

    try {
        const timeZone = getAppTimeZone();
        const now = new Date();
        const url = new URL(req.url);
        const range = parseStatsRange(url.searchParams.get('range'));
        const subjectIdParam = url.searchParams.get('subjectId');

        // 校验 subjectId 是否属于当前用户；非法时当作未筛选
        const subject = await resolveStatsSubjectId(userId, subjectIdParam);
        const subjectId = subject?.id ?? null;
        const subjectName = subject?.name ?? null;

        // 构建基础查询条件
        const baseWhere = {
            userId,
            ...(subjectId ? { subjectId } : {}),
        };

        let earliest: Date | null = null;
        if (range === 'all') {
            // 仅 all 范围需要查最早错题与最早掌握评估时间作为分桶起点
            const [earliestCreated, earliestEvaluated] = await Promise.all([
                prisma.errorItem.findFirst({
                    where: baseWhere,
                    select: { createdAt: true },
                    orderBy: { createdAt: 'asc' },
                }),
                prisma.errorItem.findFirst({
                    where: { ...baseWhere, masteryEvaluatedAt: { not: null } },
                    select: { masteryEvaluatedAt: true },
                    orderBy: { masteryEvaluatedAt: 'asc' },
                }),
            ]);
            const createdAt = earliestCreated?.createdAt;
            const evaluatedAt = earliestEvaluated?.masteryEvaluatedAt;
            earliest = createdAt && evaluatedAt
                ? (createdAt <= evaluatedAt ? createdAt : evaluatedAt)
                : (createdAt ?? evaluatedAt ?? null);
        }

        const rangeInfo = resolveStatsRange(range, earliest, now, timeZone);

        const masteryThreshold = await getMasteryThreshold(userId);

        // 时间范围筛选合并进 where
        const scopedWhere = {
            ...baseWhere,
            ...(rangeInfo.start ? { createdAt: { gte: rangeInfo.start } } : {}),
        };

        const [totalErrors, newCount, reviewingCount, masteredCount, subjectGroups, rangeItems, masteredItems, mistakeStatusGroups, errorTypeGroups, difficultyStarsGroups, difficultyStarsMasteredGroups] = await Promise.all([
            prisma.errorItem.count({ where: scopedWhere }),
            prisma.errorItem.count({
                where: { AND: [scopedWhere, masteryStatusWhere('new', masteryThreshold)] }
            }),
            prisma.errorItem.count({
                where: { AND: [scopedWhere, masteryStatusWhere('reviewing', masteryThreshold)] }
            }),
            prisma.errorItem.count({
                where: { AND: [scopedWhere, masteryStatusWhere('mastered', masteryThreshold)] }
            }),
            prisma.errorItem.groupBy({
                by: ['subjectId'],
                where: scopedWhere,
                _count: { id: true },
            }),
            prisma.errorItem.findMany({
                where: scopedWhere,
                select: { createdAt: true },
            }),
            prisma.errorItem.findMany({
                // 近似口径：以最近一次掌握评估时间（masteryEvaluatedAt）作为「掌握时间」。
                // 这类错题可能创建于范围之前，因此不套用 createdAt 范围条件，
                // 只要 masteryEvaluatedAt 落在范围起点之后即计入。
                where: {
                    ...baseWhere,
                    ...(rangeInfo.start ? { masteryEvaluatedAt: { gte: rangeInfo.start } } : {}),
                    AND: [masteryStatusWhere('mastered', masteryThreshold)],
                },
                select: { masteryEvaluatedAt: true },
            }),
            prisma.errorItem.groupBy({
                by: ['mistakeStatus'],
                where: scopedWhere,
                _count: { id: true },
            }),
            prisma.errorItem.groupBy({
                by: ['errorType'],
                where: scopedWhere,
                _count: { id: true },
            }),
            prisma.errorItem.groupBy({
                by: ['difficultyStars'],
                where: scopedWhere,
                _count: { id: true },
            }),
            prisma.errorItem.groupBy({
                by: ['difficultyStars'],
                where: { AND: [scopedWhere, masteryStatusWhere('mastered', masteryThreshold)] },
                _count: { id: true },
            }),
        ]);

        // 掌握率
        const masteryRate = totalErrors > 0 ? ((masteredCount / totalErrors) * 100).toFixed(1) : 0;

        // 学科分布：groupBy 结果一次性查学科名，subjectId 为空归为 Unknown
        const subjectIds = subjectGroups
            .map(g => g.subjectId)
            .filter((id): id is string => id !== null);
        const subjects = await prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            select: { id: true, name: true },
        });
        const subjectNameMap = new Map(subjects.map(s => [s.id, s.name]));

        const subjectStats = subjectGroups.map(g => ({
            name: g.subjectId !== null ? (subjectNameMap.get(g.subjectId) ?? 'Unknown') : 'Unknown',
            value: g._count.id,
        }));

        // 错因分布：按 mistakeStatus 分组，null 与未识别值归入 unknown
        const mistakeStatusCountMap = new Map<string, number>();
        for (const g of mistakeStatusGroups) {
            const status = normalizeMistakeStatus(g.mistakeStatus);
            mistakeStatusCountMap.set(status, (mistakeStatusCountMap.get(status) ?? 0) + g._count.id);
        }
        const mistakeStatusStats = (['not_attempted', 'wrong_attempt', 'unknown'] as const)
            .filter(status => (mistakeStatusCountMap.get(status) ?? 0) > 0)
            .map(status => ({ name: status, value: mistakeStatusCountMap.get(status) ?? 0 }));

        // 错误类型分布：合并首尾空格并忽略空值，数量前 7 个，其余并入 __other__
        const errorTypeCountMap = new Map<string, number>();
        for (const g of errorTypeGroups) {
            const name = (g.errorType ?? '').trim();
            if (!name) continue;
            errorTypeCountMap.set(name, (errorTypeCountMap.get(name) ?? 0) + g._count.id);
        }
        const ERROR_TYPE_TOP_LIMIT = 7;
        const sortedErrorTypes = [...errorTypeCountMap.entries()]
            .sort((a, b) => b[1] - a[1]);
        const errorTypeStats = sortedErrorTypes
            .slice(0, ERROR_TYPE_TOP_LIMIT)
            .map(([name, value]) => ({ name, value }));
        if (sortedErrorTypes.length > ERROR_TYPE_TOP_LIMIT) {
            const otherValue = sortedErrorTypes
                .slice(ERROR_TYPE_TOP_LIMIT)
                .reduce((sum, [, value]) => sum + value, 0);
            errorTypeStats.push({ name: '__other__', value: otherValue });
        }

        // 难度分布：始终返回 1~5 星五项（数量可为 0），未评定（null）数量大于 0 时附加
        const difficultyTotalMap = new Map<number | null, number>();
        for (const g of difficultyStarsGroups) {
            difficultyTotalMap.set(g.difficultyStars, g._count.id);
        }
        const difficultyMasteredMap = new Map<number | null, number>();
        for (const g of difficultyStarsMasteredGroups) {
            difficultyMasteredMap.set(g.difficultyStars, g._count.id);
        }
        const difficultyStarsStats: { stars: number | null; total: number; mastered: number }[] = [];
        for (let stars = 1; stars <= 5; stars++) {
            difficultyStarsStats.push({
                stars,
                total: difficultyTotalMap.get(stars) ?? 0,
                mastered: difficultyMasteredMap.get(stars) ?? 0,
            });
        }
        const unratedTotal = difficultyTotalMap.get(null) ?? 0;
        if (unratedTotal > 0) {
            difficultyStarsStats.push({
                stars: null,
                total: unratedTotal,
                mastered: difficultyMasteredMap.get(null) ?? 0,
            });
        }

        // 按分桶统计每日/每月新增与新掌握
        // 近似口径：以最近一次掌握评估时间（masteryEvaluatedAt）作为「掌握时间」
        const activityData = rangeInfo.buckets.map(bucket => {
            const added = rangeItems.filter(
                item => item.createdAt >= bucket.start && item.createdAt < bucket.end
            ).length;
            const mastered = masteredItems.filter(
                item => item.masteryEvaluatedAt !== null
                    && item.masteryEvaluatedAt >= bucket.start
                    && item.masteryEvaluatedAt < bucket.end
            ).length;
            return {
                date: bucket.label,
                // count 为兼容旧版前端保留，与 added 相同
                count: added,
                added,
                mastered,
            };
        });

        return NextResponse.json({
            totalErrors,
            newCount,
            reviewingCount,
            masteredCount,
            masteryRate,
            subjectStats,
            mistakeStatusStats,
            errorTypeStats,
            difficultyStarsStats,
            activityData,
            range: rangeInfo.range,
            granularity: rangeInfo.granularity,
            ...(subjectId ? { subjectId, subjectName } : {}),
        });

    } catch (error) {
        logger.error({ error }, 'Error fetching analytics');
        return internalError("Failed to fetch analytics");
    }
});

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { internalError } from "@/lib/api-errors";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { createLogger } from "@/lib/logger";
import { ERROR_ITEM_LIST_SELECT, ERROR_ITEM_PRINT_SELECT, printImageUrl } from "@/lib/error-list/error-list-select";
import { parseErrorListQueryParams, buildErrorListWhere } from "@/lib/error-list/error-list-query";
import { masteryStatusOf } from "@/lib/mastery-status";
import type { ErrorItemPracticeStats } from "@/types/api";

const logger = createLogger('api:error-items:list');

const PRACTICE_DIFFICULTIES = ['easy', 'medium', 'hard', 'harder'] as const;

/** 空进度：四个难度始终存在，未练习记 0/0 */
function emptyPracticeStats(): ErrorItemPracticeStats {
    return {
        easy: { correct: 0, total: 0 },
        medium: { correct: 0, total: 0 },
        hard: { correct: 0, total: 0 },
        harder: { correct: 0, total: 0 },
    };
}

/** 按难度汇总当前页错题的练习进度（答对次数 / 作答次数），一次 groupBy 取完 */
async function loadPracticeStats(ids: string[]): Promise<Map<string, ErrorItemPracticeStats>> {
    const stats = new Map<string, ErrorItemPracticeStats>();
    for (const id of ids) stats.set(id, emptyPracticeStats());
    if (ids.length === 0) return stats;

    const rows = await prisma.practiceRecord.groupBy({
        by: ['errorItemId', 'difficulty', 'result'],
        where: {
            errorItemId: { in: ids },
            result: { in: ['correct', 'wrong', 'not_attempted'] },
        },
        _count: { _all: true },
    });

    for (const row of rows) {
        const entry = stats.get(row.errorItemId ?? '');
        const difficulty = row.difficulty;
        if (!entry || !PRACTICE_DIFFICULTIES.includes(difficulty as typeof PRACTICE_DIFFICULTIES[number])) continue;
        const target = entry[difficulty as typeof PRACTICE_DIFFICULTIES[number]];
        target.total += row._count._all;
        if (row.result === 'correct') target.correct += row._count._all;
    }
    return stats;
}

export const GET = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    const { searchParams } = new URL(req.url);
    const params = parseErrorListQueryParams(searchParams);

    try {
        const whereClause = await buildErrorListWhere(params, user.id, user.masteryThreshold, prisma);

        // 获取总数
        const total = await prisma.errorItem.count({
            where: whereClause,
        });

        // 分页查询
        const pageArgs = { where: whereClause, orderBy: { createdAt: "desc" as const }, skip: (params.page - 1) * params.pageSize, take: params.pageSize };
        const items = params.view === "print"
            ? await findPrintItems(pageArgs)
            : await prisma.errorItem.findMany({ ...pageArgs, select: ERROR_ITEM_LIST_SELECT });

        const totalPages = Math.ceil(total / params.pageSize);

        // 练习进度只用于列表卡片，打印视图不需要
        const practiceStats = params.view === "print" ? null : await loadPracticeStats(items.map((item) => item.id));

        return NextResponse.json({
            items: items.map(({ _count, ...item }) => ({
                ...item,
                masteryStatus: masteryStatusOf(_count.practiceRecords, item.masteryProbability, user.masteryThreshold),
                ...(practiceStats ? { practiceStats: practiceStats.get(item.id) } : {}),
            })),
            total,
            page: params.page,
            pageSize: params.pageSize,
            totalPages,
        });
    } catch (error) {
        logger.error({ error }, 'Error fetching items');
        return internalError("Failed to fetch error items");
    }
});

/**
 * 打印视图：读取解答与配图；base64 原图换成懒加载的图片接口链接，外部链接原样返回。
 * 原图类型只在 SQLite 中按前缀判断，不把 base64 读入服务端内存，也不随列表返回。
 */
async function findPrintItems(args: Pick<Prisma.ErrorItemFindManyArgs, "where" | "orderBy" | "skip" | "take">) {
    const rows = await prisma.errorItem.findMany({ ...args, select: ERROR_ITEM_PRINT_SELECT });
    const inlineIds = new Set<string>();
    const externalUrls = new Map<string, string>();
    // 原图分两类：内嵌 base64 换成本地图片接口，外部链接原样返回。
    // 按批查询：单个查询绑定过多 id 时 Prisma 需要拆分，而拆分会因「非内嵌」这类否定条件失败并触发
    // SQLite 参数上限；每批 500 条远低于该上限，既保留在 SQL 里按前缀判断、不把 base64 读进内存。
    for (let start = 0; start < rows.length; start += PRINT_IMAGE_BATCH_SIZE) {
        const ids = rows.slice(start, start + PRINT_IMAGE_BATCH_SIZE).map((row) => row.id);
        const isInline = { originalImageUrl: { startsWith: "data:" } };
        const [inline, external] = await Promise.all([
            prisma.errorItem.findMany({ where: { id: { in: ids }, ...isInline }, select: { id: true } }),
            prisma.errorItem.findMany({
                where: { id: { in: ids }, originalImageUrl: { not: "" }, NOT: isInline },
                select: { id: true, originalImageUrl: true },
            }),
        ]);
        for (const row of inline) inlineIds.add(row.id);
        for (const row of external) externalUrls.set(row.id, row.originalImageUrl);
    }
    return rows.map(({ updatedAt, ...row }) => ({
        ...row,
        originalImageUrl: inlineIds.has(row.id) ? printImageUrl(row.id, updatedAt) : externalUrls.get(row.id) ?? "",
    }));
}

/** 每批 id 数：低于 SQLite 单条查询的参数上限，避免 Prisma 拆分带否定条件的查询 */
const PRINT_IMAGE_BATCH_SIZE = 500;

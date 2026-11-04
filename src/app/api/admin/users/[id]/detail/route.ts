import { NextResponse } from "next/server"
import { withAdmin } from "@/lib/api-handler"
import { prisma } from "@/lib/prisma"
import { notFound, internalError } from "@/lib/api-errors"
import { countByMasteryStatus } from "@/lib/mastery"
import { PRACTICE_RECORD_COUNT, masteryStatusOf } from "@/lib/mastery-status"
import { createLogger } from "@/lib/logger"

const logger = createLogger('api:admin:users:id:detail')

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withAdmin(async (_req: Request, { params }: RouteContext) => {
    const { id } = await params;

    try {
        // 获取用户基本信息
        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                createdAt: true,
                educationStage: true,
                enrollmentYear: true,
                masteryThreshold: true,
            }
        })

        if (!user) {
            return notFound("User not found")
        }

        // 错题本列表及每个本子的错题数
        const notebooks = await prisma.subject.findMany({
            where: { userId: id },
            select: {
                id: true,
                name: true,
                _count: {
                    select: { errorItems: true }
                }
            },
            orderBy: { createdAt: 'asc' }
        })

        // 错题总数
        const errorCount = await prisma.errorItem.count({
            where: { userId: id }
        })

        // 练习记录总数
        const practiceCount = await prisma.practiceRecord.count({
            where: { userId: id }
        })

        // 错题本总数
        const notebookCount = notebooks.length

        // 最近 7 天录入的错题数
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        const recent7DaysCount = await prisma.errorItem.count({
            where: {
                userId: id,
                createdAt: { gte: sevenDaysAgo }
            }
        })

        // 掌握度分布
        const masteryDistribution = await countByMasteryStatus({ userId: id })

        // 学科错题分布（按 subjectId 分组）
        const subjectErrorCounts = await prisma.errorItem.groupBy({
            by: ['subjectId'],
            where: { userId: id },
            _count: { id: true }
        })
        const subjectIds = subjectErrorCounts.map(s => s.subjectId).filter(Boolean) as string[]
        const subjectNames = await prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            select: { id: true, name: true }
        })
        const subjectNameMap = new Map(subjectNames.map(s => [s.id, s.name]))
        const subjectDistribution = subjectErrorCounts
            .filter(s => s.subjectId)
            .map(s => ({
                name: subjectNameMap.get(s.subjectId!) || "未知",
                count: s._count.id
            }))

        // 最近录入的错题（最新 20 条）
        const recentErrorItems = await prisma.errorItem.findMany({
            where: { userId: id },
            select: {
                id: true,
                questionText: true,
                ocrText: true,
                masteryProbability: true,
                createdAt: true,
                _count: PRACTICE_RECORD_COUNT,
                subject: {
                    select: { name: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 20
        })

        return NextResponse.json({
            user,
            notebooks: notebooks.map(nb => ({
                id: nb.id,
                name: nb.name,
                errorCount: nb._count.errorItems,
            })),
            errorCount,
            practiceCount,
            notebookCount,
            recent7DaysCount,
            masteryDistribution,
            subjectDistribution,
            recentErrorItems: recentErrorItems.map(item => ({
                id: item.id,
                questionText: item.questionText,
                ocrText: item.ocrText,
                masteryStatus: masteryStatusOf(item._count.practiceRecords, item.masteryProbability, user.masteryThreshold),
                createdAt: item.createdAt,
                subject: item.subject,
            })),
        })
    } catch (error) {
        logger.error({ error, userId: id }, 'Error fetching user detail');
        return internalError("Failed to fetch user detail")
    }
})

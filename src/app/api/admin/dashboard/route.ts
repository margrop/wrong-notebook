import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth-utils"
import { forbidden, internalError } from "@/lib/api-errors"
import { countByMasteryStatus } from "@/lib/mastery"
import { createLogger } from "@/lib/logger"
import { getAppTimeZone } from "@/lib/config"
import { formatDateTime, getDayRange } from "@/lib/date-time"

const logger = createLogger('api:admin:dashboard')

/** 不同用户的同名错题本（如都叫「英语」）合并计数，按错题数从多到少排列 */
function mergeSubjectsByName(subjects: { name: string; _count: { errorItems: number } }[]) {
    const counts = new Map<string, number>()
    for (const subject of subjects) {
        counts.set(subject.name, (counts.get(subject.name) || 0) + subject._count.errorItems)
    }
    return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

export async function GET() {
    const session = await getServerSession(authOptions)

    if (!requireAdmin(session)) {
        return forbidden("Admin access required")
    }

    try {
        // 总用户数
        const totalUsers = await prisma.user.count()

        // 总错题数
        const totalErrorItems = await prisma.errorItem.count()

        // 总练习记录数
        const totalPracticeRecords = await prisma.practiceRecord.count()

        // 总错题本数
        const totalSubjects = await prisma.subject.count()

        // 每个用户的详细统计
        const userStats = await prisma.user.findMany({
            orderBy: {
                createdAt: 'desc'
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                createdAt: true,
                educationStage: true,
                enrollmentYear: true,
                _count: {
                    select: {
                        errorItems: true,
                        practiceRecords: true,
                        subjects: true,
                    }
                }
            }
        })

        // 按学科统计错题分布
        const subjectDistribution = await prisma.subject.findMany({
            select: {
                name: true,
                _count: {
                    select: {
                        errorItems: true
                    }
                }
            },
            orderBy: {
                errorItems: {
                    _count: 'desc'
                }
            }
        })

        // 最近 7 天的错题录入趋势
        const now = new Date()
        const timeZone = getAppTimeZone()
        const sevenDaysAgo = getDayRange(now, timeZone, -6).start
        const recentErrorItems = await prisma.errorItem.groupBy({
            by: ['createdAt'],
            where: {
                createdAt: {
                    gte: sevenDaysAgo
                }
            },
            _count: {
                id: true
            }
        })

        // 按日期聚合最近 7 天数据
        const dailyTrend: { date: string; count: number }[] = []
        for (let i = 6; i >= 0; i--) {
            const dateStr = formatDateTime(getDayRange(now, timeZone, -i).start, 'yyyy-MM-dd', timeZone)
            dailyTrend.push({ date: dateStr, count: 0 })
        }
        for (const item of recentErrorItems) {
            const dateStr = formatDateTime(item.createdAt, 'yyyy-MM-dd', timeZone)
            const found = dailyTrend.find(d => d.date === dateStr)
            if (found) {
                found.count += item._count.id
            }
        }

        // 掌握度统计 (全局)
        const masteryDistribution = await countByMasteryStatus()

        return NextResponse.json({
            overview: {
                totalUsers,
                totalErrorItems,
                totalPracticeRecords,
                totalSubjects,
            },
            userStats: userStats.map(u => ({
                id: u.id,
                name: u.name,
                email: u.email,
                role: u.role,
                isActive: u.isActive,
                createdAt: u.createdAt,
                educationStage: u.educationStage,
                enrollmentYear: u.enrollmentYear,
                errorCount: u._count.errorItems,
                practiceCount: u._count.practiceRecords,
                notebookCount: u._count.subjects,
            })),
            subjectDistribution: mergeSubjectsByName(subjectDistribution),
            dailyTrend,
            masteryDistribution,
        })
    } catch (error) {
        logger.error({ error }, 'Error fetching dashboard data');
        return internalError("Failed to fetch dashboard data")
    }
}

import { NextResponse } from "next/server"
import { withAdmin } from "@/lib/api-handler"
import { prisma } from "@/lib/prisma"
import { internalError } from "@/lib/api-errors"
import { createLogger } from "@/lib/logger"
import { getAppTimeZone } from "@/lib/config"
import { getDayRange } from "@/lib/date-time"

const logger = createLogger('api:admin:users');

export const GET = withAdmin(async () => {
    try {
        const users = await prisma.user.findMany({
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
                _count: {
                    select: {
                        errorItems: true,
                        practiceRecords: true
                    }
                }
            }
        })

        // 今日 AI 调用次数，便于管理员了解用量并设置额度
        const { start, end } = getDayRange(new Date(), getAppTimeZone())
        const usage = await prisma.aiUsage.groupBy({
            by: ['userId'],
            where: { createdAt: { gte: start, lt: end } },
            _count: { _all: true },
        })
        const usageByUser = new Map(usage.map((entry) => [entry.userId, entry._count._all]))

        return NextResponse.json(users.map((user) => ({ ...user, aiUsageToday: usageByUser.get(user.id) ?? 0 })))
    } catch (error) {
        logger.error({ error }, 'Error fetching users');
        return internalError("Failed to fetch users")
    }
})

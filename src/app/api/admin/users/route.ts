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

        // 今日 AI 调用次数与 token 用量（含后台掌握概率评估），便于管理员了解用量并设置额度
        const { start, end } = getDayRange(new Date(), getAppTimeZone())
        const today = { createdAt: { gte: start, lt: end } }
        const [usage, tokens] = await Promise.all([
            prisma.aiUsage.groupBy({ by: ['userId'], where: today, _count: { _all: true } }),
            prisma.aiCompletion.groupBy({ by: ['userId'], where: today, _sum: { inputTokens: true, outputTokens: true } }),
        ])
        const usageByUser = new Map(usage.map((entry) => [entry.userId, entry._count._all]))
        const tokensByUser = new Map(tokens.map((entry) => [entry.userId, {
            input: entry._sum.inputTokens ?? 0,
            output: entry._sum.outputTokens ?? 0,
        }]))

        return NextResponse.json(users.map((user) => ({
            ...user,
            aiUsageToday: usageByUser.get(user.id) ?? 0,
            aiTokensToday: tokensByUser.get(user.id) ?? { input: 0, output: 0 },
        })))
    } catch (error) {
        logger.error({ error }, 'Error fetching users');
        return internalError("Failed to fetch users")
    }
})

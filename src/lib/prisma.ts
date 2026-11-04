// 不加 server-only：scripts/ 下的种子与维护脚本（Docker、安装包启动时以普通 node 运行）直接导入本模块
import { PrismaClient } from '@prisma/client'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        log: process.env.DEBUG_DB === 'true'
            ? ['query', 'error', 'warn']
            : (process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']),
    })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

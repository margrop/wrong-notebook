/**
 * 增量补齐大学年级根节点（大一 ~ 大四），不删除或改动已有标签。
 * 已有安装（PRESERVE_EXISTING_DATA=true）不会重建系统标签，靠本脚本补上年级节点。
 * 源码运行：npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-university-grades.ts
 * Docker 和安装包运行：node dist-scripts/scripts/seed-university-grades.js
 */
import { PrismaClient } from '@prisma/client';
import { getErrorMessage } from '../src/lib/error-message';
import { createLogger } from '../src/lib/logger';
import { seedUniversityGrades } from '../src/lib/tags/seed/university-grades';

const logger = createLogger('seed-university-grades');

async function main() {
    const prisma = new PrismaClient();
    try {
        const created = await prisma.$transaction((tx) => seedUniversityGrades(tx), { timeout: 120000 });
        logger.info({ created }, '大学年级节点同步完成');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    logger.error({ error: getErrorMessage(error) }, '大学年级节点同步失败');
    process.exitCode = 1;
});
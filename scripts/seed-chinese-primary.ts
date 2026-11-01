/**
 * 增量补齐小学、初中和高中语文系统标签，不删除已有标签。
 * 源码运行：npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-chinese-primary.ts
 * Docker 和安装包运行：node dist-scripts/scripts/seed-chinese-primary.js
 */
import { PrismaClient } from '@prisma/client';
import { getErrorMessage } from '../src/lib/error-message';
import { createLogger } from '../src/lib/logger';
import { seedChineseTags } from '../src/lib/seed-chinese-tags';

const logger = createLogger('seed-chinese-tags');

async function main() {
    const prisma = new PrismaClient();
    try {
        const result = await seedChineseTags(prisma);
        logger.info(result, '语文系统标签同步完成');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    logger.error({ error: getErrorMessage(error) }, '语文系统标签同步失败');
    process.exitCode = 1;
});

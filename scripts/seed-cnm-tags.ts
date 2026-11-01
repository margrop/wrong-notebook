/**
 * 人教版课标知识点（cn-math-taxonomy）命令行导入脚本
 *
 * 管理员也可在「设置 → 用户管理 → 人教版课标知识点」中上传 topics.json 导入，两者逻辑相同。
 * 增量导入为 tagSet = "cnm" 的标签体系，不删除、不修改已有数据，可重复执行。
 *
 * 使用方法：
 *   1. 下载数据文件（约 2.6MB）：
 *      mkdir -p scripts/data
 *      curl -L -o scripts/data/cn-math-taxonomy-topics.json \
 *        https://raw.githubusercontent.com/xiaoyang111222/cn-math-taxonomy/HEAD/data/topics.json
 *   2. 执行导入（可用第一个参数指定其他文件路径）：
 *      DATABASE_URL="file:./dev.db" npx tsx scripts/seed-cnm-tags.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { CNM_TOPICS_URL, cnmTopicsSchema, getCnmStatus, importCnmTopics } from '../src/lib/cnm-tags';

const prisma = new PrismaClient();

async function main() {
    const filePath = process.argv[2] || path.join(__dirname, 'data', 'cn-math-taxonomy-topics.json');
    if (!fs.existsSync(filePath)) {
        console.error(`❌ 找不到文件: ${filePath}`);
        console.error(`请先下载 topics.json：${CNM_TOPICS_URL}`);
        process.exit(1);
    }

    const topics = cnmTopicsSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    console.log(`📖 共 ${topics.length} 个知识点，开始导入...`);
    const result = await importCnmTopics(prisma, topics);
    const status = await getCnmStatus(prisma);
    console.log('✅ 导入完成!');
    console.log(`  新建 ${result.created} 个，已存在跳过 ${result.skipped} 个，不支持的学科或年级忽略 ${result.ignored} 个`);
    console.log(`  当前课标体系共 ${status.knowledgePoints} 个知识点`);
}

main()
    .catch((e) => {
        console.error('❌ 导入失败:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

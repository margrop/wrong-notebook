/**
 * 额外学科（语文、历史、地理、政治）标签导入脚本
 * 仅导入年级结构，以支持自定义标签的年级选择
 * 
 * 使用方法: npx tsx scripts/seed-additional-subjects.ts
 */

import { PrismaClient } from '@prisma/client';
import { CHINESE_CURRICULUM, CHINESE_GRADE_ORDER } from '../src/lib/tags/data/chinese';
import { HISTORY_CURRICULUM, HISTORY_GRADE_ORDER } from '../src/lib/tags/data/history';
import { GEOGRAPHY_CURRICULUM, GEOGRAPHY_GRADE_ORDER } from '../src/lib/tags/data/geography';
import { POLITICS_CURRICULUM, POLITICS_GRADE_ORDER } from '../src/lib/tags/data/politics';

const prisma = new PrismaClient();

async function seedSubject(
    subjectKey: string,
    subjectName: string,
    curriculum: Record<string, any[]>,
    gradeOrder: Record<string, number>
) {
    console.log(`\n📚 处理学科: ${subjectName} (${subjectKey})`);

    // 清空现有系统标签
    console.log(`  🗑️  清空现有系统标签...`);
    await prisma.knowledgeTag.deleteMany({
        where: { isSystem: true, subject: subjectKey }
    });

    let count = 0;
    for (const [gradeSemester, _] of Object.entries(curriculum)) {
        // 创建年级节点
        await prisma.knowledgeTag.create({
            data: {
                name: gradeSemester,
                subject: subjectKey,
                parentId: null,
                isSystem: true,
                order: gradeOrder[gradeSemester] || 99,
            },
        });
        count++;
    }
    console.log(`  ✅ ${subjectName} 年级节点创建完成: ${count} 个`);
}

async function main() {
    console.log('🚀 开始导入额外学科标签结构...');

    await seedSubject('chinese', '语文', CHINESE_CURRICULUM, CHINESE_GRADE_ORDER);
    await seedSubject('history', '历史', HISTORY_CURRICULUM, HISTORY_GRADE_ORDER);
    await seedSubject('geography', '地理', GEOGRAPHY_CURRICULUM, GEOGRAPHY_GRADE_ORDER);
    await seedSubject('politics', '政治', POLITICS_CURRICULUM, POLITICS_GRADE_ORDER);

    console.log('\n✨ 所有额外学科标签导入完成!');
}

main()
    .catch((e) => {
        console.error('❌ 导入失败:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

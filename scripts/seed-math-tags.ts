/**
 * 数学标签导入脚本
 * 将数学课程大纲导入到 KnowledgeTag 表
 * 
 * 使用方法: npx tsx scripts/seed-math-tags.ts
 */

import { PrismaClient } from '@prisma/client';
import { MATH_CURRICULUM, MATH_GRADE_ORDER } from '../src/lib/tags/data/math';

const prisma = new PrismaClient();

async function main() {
    console.log('📐 开始导入数学标签...');

    // 清空现有数学系统标签
    console.log('🗑️  清空现有数学系统标签...');
    await prisma.knowledgeTag.deleteMany({
        where: { isSystem: true, subject: 'math' }
    });

    let totalCreated = 0;

    for (const [gradeSemester, chapters] of Object.entries(MATH_CURRICULUM)) {
        console.log(`\n📚 处理年级: ${gradeSemester}`);

        // 创建年级节点
        const gradeNode = await prisma.knowledgeTag.create({
            data: {
                name: gradeSemester,
                subject: 'math',
                parentId: null,
                isSystem: true,
                order: MATH_GRADE_ORDER[gradeSemester] || 99,
            },
        });
        totalCreated++;

        for (let chapterIdx = 0; chapterIdx < chapters.length; chapterIdx++) {
            const chapter = chapters[chapterIdx];
            console.log(`  📖 章节: ${chapter.chapter}`);

            // 创建章节节点
            const chapterNode = await prisma.knowledgeTag.create({
                data: {
                    name: chapter.chapter,
                    subject: 'math',
                    parentId: gradeNode.id,
                    isSystem: true,
                    order: chapterIdx + 1,
                },
            });
            totalCreated++;

            // 创建节和知识点
            for (let sectionIdx = 0; sectionIdx < chapter.sections.length; sectionIdx++) {
                const section = chapter.sections[sectionIdx];

                // 创建节节点
                const sectionNode = await prisma.knowledgeTag.create({
                    data: {
                        name: section.section,
                        subject: 'math',
                        parentId: chapterNode.id,
                        isSystem: true,
                        order: sectionIdx + 1,
                    },
                });
                totalCreated++;

                // 创建知识点
                for (let tagIdx = 0; tagIdx < section.tags.length; tagIdx++) {
                    const tagName = section.tags[tagIdx];
                    await prisma.knowledgeTag.create({
                        data: {
                            name: tagName,
                            subject: 'math',
                            parentId: sectionNode.id,
                            isSystem: true,
                            order: tagIdx + 1,
                        },
                    });
                    totalCreated++;
                }
            }
        }
    }

    console.log(`\n✅ 数学标签导入完成! 共创建 ${totalCreated} 个标签`);
}

main()
    .catch((e) => {
        console.error('❌ 导入失败:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

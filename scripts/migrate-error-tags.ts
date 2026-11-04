/**
 * 错题知识点迁移脚本
 * 将现有 ErrorItem.knowledgePoints (JSON string) 迁移到 KnowledgeTag 关联
 * 
 * 使用: npx tsx scripts/migrate-error-tags.ts
 */

import { PrismaClient } from '@prisma/client';
import { findParentTagIdForGrade } from '../src/lib/tags/tag-recognition';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 开始迁移错题知识点数据...\n');

    // 获取所有有 knowledgePoints 的错题
    const errorItems = await prisma.errorItem.findMany({
        where: {
            knowledgePoints: { not: null }
        },
        select: {
            id: true,
            knowledgePoints: true,
            subject: {
                select: { name: true }
            },
            gradeSemester: true,
        }
    });

    console.log(`📊 找到 ${errorItems.length} 条需要迁移的错题\n`);

    let migratedCount = 0;
    let createdTagsCount = 0;
    let linkedTagsCount = 0;

    for (const item of errorItems) {
        if (!item.knowledgePoints) continue;

        // 解析知识点 (可能是 JSON 数组或逗号分隔字符串)
        let tags: string[] = [];
        try {
            const parsed = JSON.parse(item.knowledgePoints);
            if (Array.isArray(parsed)) {
                tags = parsed.filter((t): t is string => typeof t === 'string');
            }
        } catch {
            // 尝试逗号分隔
            tags = item.knowledgePoints.split(',').map(t => t.trim()).filter(Boolean);
        }

        if (tags.length === 0) continue;

        // 推断学科
        const subject = item.subject?.name?.toLowerCase() || 'math';
        const subjectKey = subject.includes('math') || subject.includes('数学') ? 'math' :
            subject.includes('english') || subject.includes('英语') ? 'english' :
                subject.includes('physics') || subject.includes('物理') ? 'physics' :
                    subject.includes('chemistry') || subject.includes('化学') ? 'chemistry' : 'other';

        // 为每个标签找到或创建对应的 KnowledgeTag
        const tagIds: string[] = [];
        for (const tagName of tags) {
            // 先查找是否存在
            let tag = await prisma.knowledgeTag.findFirst({
                where: {
                    name: tagName,
                    subject: subjectKey,
                }
            });

            // 不存在则创建为自定义标签 (系统级)
            if (!tag) {
                // 尝试根据错题的年级学期查找 parentId
                const gradeStr = item.gradeSemester;
                const parentId = await findParentTagIdForGrade(gradeStr, subjectKey);

                tag = await prisma.knowledgeTag.create({
                    data: {
                        name: tagName,
                        subject: subjectKey,
                        isSystem: false, // 标记为非系统标签，但无用户归属
                        parentId: parentId || null
                    }
                });
                createdTagsCount++;
            }

            tagIds.push(tag.id);
        }

        // 关联到错题
        if (tagIds.length > 0) {
            await prisma.errorItem.update({
                where: { id: item.id },
                data: {
                    tags: {
                        connect: tagIds.map(id => ({ id }))
                    }
                }
            });
            linkedTagsCount += tagIds.length;
        }

        migratedCount++;
        if (migratedCount % 50 === 0) {
            console.log(`  已处理 ${migratedCount}/${errorItems.length} 条...`);
        }
    }

    console.log(`\n✅ 迁移完成!`);
    console.log(`   - 处理错题数: ${migratedCount}`);
    console.log(`   - 新建标签数: ${createdTagsCount}`);
    console.log(`   - 创建关联数: ${linkedTagsCount}`);
}

main()
    .catch((e) => {
        console.error('❌ 迁移失败:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

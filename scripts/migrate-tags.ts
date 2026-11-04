
import { PrismaClient } from '@prisma/client';
import { inferSubjectFromName } from '../src/lib/tags/knowledge-tags';
import { findParentTagIdForGrade } from '../src/lib/tags/tag-recognition';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 开始迁移旧版标签数据...');

    const errorItems = await prisma.errorItem.findMany({
        where: {
            // Find items that have knowledgePoints but no tags connected (or just process all)
            // It's safer to process all that have knowledgePoints string
            knowledgePoints: {
                not: null,
            },
        },
        select: {
            id: true,
            userId: true,
            knowledgePoints: true, // Note: This field is on the model
            gradeSemester: true,
            subject: {
                select: { name: true }
            },
            tags: {
                select: { id: true }
            }
        },
    });

    console.log(`📦 找到 ${errorItems.length} 个包含旧版标签数据的错题。`);

    let updatedCount = 0;

    for (const item of errorItems) {
        if (!item.knowledgePoints || item.knowledgePoints === '[]') continue;

        let tagNames: string[] = [];
        try {
            // Try parsing JSON list
            const parsed = JSON.parse(item.knowledgePoints);
            if (Array.isArray(parsed)) {
                tagNames = parsed;
            } else if (typeof parsed === 'string') {
                // Sometimes it might be double stringified or just a string?
                tagNames = [parsed];
            }
        } catch (e) {
            // If not JSON, treat as single tag string if not empty
            if (item.knowledgePoints.trim()) {
                tagNames = [item.knowledgePoints];
            }
        }

        if (tagNames.length === 0) continue;

        // Infer subject
        const subjectKey = inferSubjectFromName(item.subject?.name || null) || 'other';

        const tagConnections: { id: string }[] = [];

        for (const tagName of tagNames) {
            // Find or create tag
            // Note: We check system tags OR user tags
            let tag = await prisma.knowledgeTag.findFirst({
                where: {
                    name: tagName,
                    OR: [
                        { isSystem: true },
                        { userId: item.userId },
                    ],
                },
            });

            if (!tag) {
                console.log(`   ✨ 创建新标签: ${tagName} for user ${item.userId}`);
                // 尝试根据错题的年级学期查找 parentId
                const gradeStr = item.gradeSemester; // item need to include gradeSemester
                const parentId = await findParentTagIdForGrade(gradeStr, subjectKey);

                tag = await prisma.knowledgeTag.create({
                    data: {
                        name: tagName,
                        subject: subjectKey,
                        isSystem: false,
                        userId: item.userId,
                        parentId: parentId || null
                    },
                });
            }

            tagConnections.push({ id: tag.id });
        }

        // Connect tags to error item
        // usage of 'connect' ensures we don't duplicate relationships if they already exist
        // but 'set' might be cleaner to ensure exact match with legacy string?
        // Let's use connect to be additive, or set to be authoritative?
        // Since migration is run once, 'connect' is safe.
        // Wait, if we run it multiple times, 'connect' is fine because Prisma handles duplicates in connect nicely (it just needs unique IDs).
        // Actually for many-to-many, connect needs ID.

        // Let's check if already connected to avoid unnecessary writes
        const existingIds = new Set(item.tags.map(t => t.id));
        const newConnections = tagConnections.filter(t => !existingIds.has(t.id));

        if (newConnections.length > 0) {
            await prisma.errorItem.update({
                where: { id: item.id },
                data: {
                    tags: {
                        connect: newConnections,
                    },
                },
            });
            updatedCount++;
            process.stdout.write('.');
        }
    }

    console.log(`\n✅ 迁移完成! 更新了 ${updatedCount} 个错题的标签关联。`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

import type { PrismaClient } from '@prisma/client';
// Docker 与安装包构建时用 tsc 单独编译种子脚本（不读取 tsconfig 路径别名），本文件及其依赖只能用相对路径导入
import { CHINESE_CURRICULUM, CHINESE_GRADE_ORDER } from '../data/chinese';

/** 增量补齐内置语文标签，保留已有标签 ID、题目关联和其他标签体系。 */
export async function seedChineseTags(prisma: PrismaClient) {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.knowledgeTag.findMany({
            where: { subject: 'chinese', isSystem: true, userId: null, tagSet: 'default' },
            select: { id: true, name: true, parentId: true, order: true },
            orderBy: { createdAt: 'asc' },
        });
        const key = (name: string, parentId: string | null) => JSON.stringify([parentId, name]);
        const byPath = new Map<string, (typeof existing)[number]>();
        for (const tag of existing) {
            // 旧数据若有重复节点，沿用最早的节点，不删除或合并既有数据。
            const path = key(tag.name, tag.parentId);
            if (!byPath.has(path)) byPath.set(path, tag);
        }
        let created = 0;
        let updated = 0;

        async function ensureTag(name: string, parentId: string | null, order: number) {
            const path = key(name, parentId);
            const tag = byPath.get(path);
            if (tag) {
                if (tag.order !== order) {
                    await tx.knowledgeTag.update({ where: { id: tag.id }, data: { order } });
                    tag.order = order;
                    updated++;
                }
                return tag.id;
            }
            const added = await tx.knowledgeTag.create({
                data: { name, parentId, order, subject: 'chinese', isSystem: true, tagSet: 'default' },
                select: { id: true, name: true, parentId: true, order: true },
            });
            byPath.set(path, added);
            created++;
            return added.id;
        }

        for (const [grade, chapters] of Object.entries(CHINESE_CURRICULUM)) {
            const gradeId = await ensureTag(grade, null, CHINESE_GRADE_ORDER[grade] ?? 99);
            for (const [chapterIndex, chapter] of chapters.entries()) {
                const chapterId = await ensureTag(chapter.chapter, gradeId, chapterIndex + 1);
                for (const [tagIndex, name] of chapter.tags.entries()) {
                    await ensureTag(name, chapterId, tagIndex + 1);
                }
            }
        }
        return { created, updated };
    }, { timeout: 120000 });
}

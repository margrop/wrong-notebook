/**
 * 导入步骤：系统标签与自定义标签的映射与创建，以及错题标签的预加载。
 * 保留原实现：按导出 id 建立映射、通过 sortTagsByParent 保留父子路径。
 */
import { sortTagsByParent } from "@/lib/tags/tag-hierarchy";
import type { ImportContext } from "./types";

/** 2. 按体系和父节点路径导入系统标签，保留不同年级下的同名章节与知识点。 */
export async function importSystemTags(ctx: ImportContext): Promise<void> {
    const { tx, normalized, systemTagIdMap } = ctx;
    for (const tag of sortTagsByParent(normalized.systemTags)) {
        const parentId = tag.parentId ? systemTagIdMap.get(tag.parentId) ?? null : null;
        const existing = await tx.knowledgeTag.findFirst({
            where: {
                name: tag.name,
                subject: tag.subject,
                isSystem: true,
                tagSet: tag.tagSet || 'default',
                parentId,
            },
        });
        if (existing) {
            systemTagIdMap.set(tag.id, existing.id);
        } else {
            const created = await tx.knowledgeTag.create({
                data: {
                    name: tag.name,
                    subject: tag.subject,
                    isSystem: true,
                    tagSet: tag.tagSet || 'default',
                    parentId,
                    order: tag.order || 0,
                    code: tag.code,
                },
            });
            systemTagIdMap.set(tag.id, created.id);
        }
    }
}

/** 3. 导入 custom tags，父节点先在自定义映射、再在系统映射中查找 */
export async function importCustomTags(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, stats, tagIdMap, systemTagIdMap } = ctx;
    for (const tag of sortTagsByParent(normalized.customTags)) {
        const targetUserId = importAll ? tag.userId! : user.id;
        const tagSet = tag.tagSet || 'default';
        const parentId = tag.parentId ? tagIdMap.get(tag.parentId) ?? systemTagIdMap.get(tag.parentId) ?? null : null;
        const existing = await tx.knowledgeTag.findFirst({
            where: {
                name: tag.name,
                subject: tag.subject,
                userId: targetUserId,
                isSystem: false,
                tagSet,
                parentId,
            },
        });
        if (existing) {
            tagIdMap.set(tag.id, existing.id);
        } else {
            const created = await tx.knowledgeTag.create({
                data: {
                    name: tag.name,
                    subject: tag.subject,
                    isSystem: false,
                    userId: targetUserId,
                    tagSet: tag.tagSet || 'default',
                    parentId,
                    order: tag.order || 0,
                    code: tag.code,
                },
            });
            tagIdMap.set(tag.id, created.id);
            stats.tagsCreated++;
        }
    }
}

/** 4. 预加载所有需要的 tags（批量查询，避免 N+1），供错题关联时按体系与名称匹配 */
export async function preloadErrorItemTags(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, subjectTagSetMap, tagBySetAndName, tagNameMap } = ctx;
    for (const subject of normalized.subjects) {
        if (subject.tagSet) {
            subjectTagSetMap.set(subject.id, subject.tagSet);
        }
    }
    const allTagNames = new Set<string>();
    for (const item of normalized.errorItems) {
        if (item.raw.tags) {
            for (const tag of item.raw.tags) {
                allTagNames.add(tag.name);
            }
        }
    }
    // 批量查询：系统 tag + 所有用户的自定义 tag
    const preloadedTags = await tx.knowledgeTag.findMany({
        where: {
            name: { in: Array.from(allTagNames) },
            OR: [
                { isSystem: true },
                ...(importAll ? [] : [{ userId: user.id }]),
            ],
        },
    });
    // 按 (tagSet, name) 建索引，错题关联时按错题本 tagSet 精确匹配系统标签
    for (const tag of preloadedTags) {
        const key = `${tag.tagSet}::${tag.name}`;
        if (!tagBySetAndName.has(key) || (!importAll && tag.userId === user.id)) {
            tagBySetAndName.set(key, tag.id);
        }
    }
    // 兼容旧版导出文件：不区分 tagSet 时按名字兜底
    for (const tag of preloadedTags) {
        if (!tagNameMap.has(tag.name) || (!importAll && tag.userId === user.id)) {
            tagNameMap.set(tag.name, tag.id);
        }
    }
}

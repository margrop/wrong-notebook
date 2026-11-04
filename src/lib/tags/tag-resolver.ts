/**
 * 按名称查找或创建知识点标签的公共逻辑：
 * 在指定错题本的标签体系（tagSet）内按名称找系统标签或当前用户的标签，
 * 找不到时通过 findParentTagIdForGrade 找到年级父节点后新建用户标签。
 * 「添加错题」接口、批量导入、错题编辑、数据导入等多处共用。
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { createLogger } from "@/lib/logger";
import { findParentTagIdForGrade } from "@/lib/tags/tag-recognition";
import { resolveNotebookScope } from "@/lib/notebook-scope";

const logger = createLogger('tag-resolver');

/**
 * 从错题本记录推断标签写入时使用的学科与标签体系。
 * 学科以错题本创建时保存的 subjectKey 为准，旧错题本没有该字段时按名称推断（与 resolveNotebookScope 一致），
 * 推断不出时为 other；标签体系取错题本自身值，缺省为 default。
 */
export function inferTagScope(
    subject: { name: string; tagSet: string | null; subjectKey?: string | null; stage?: string | null } | null | undefined,
): { subjectKey: string; tagSet: string } {
    return {
        subjectKey: (subject ? resolveNotebookScope(subject).subject : null) || 'other',
        tagSet: subject?.tagSet || 'default',
    };
}

export interface ResolveTagsInput {
    userId: string;
    tagNames: string[];
    subjectKey: string;
    tagSet: string;
    gradeSemester: string | null | undefined;
}

/**
 * 在 tagSet 内按名称找系统标签或当前用户的标签；找不到则挂到年级父节点下新建用户标签。
 * 重复的 tagName 只处理一次（保持首次出现顺序），空字符串/纯空白名称跳过。
 */
export async function resolveOrCreateTags(
    client: Prisma.TransactionClient | PrismaClient,
    input: ResolveTagsInput,
): Promise<{ id: string }[]> {
    const { userId, tagNames, subjectKey, tagSet, gradeSemester } = input;
    const tagConnections: { id: string }[] = [];

    // 去重并保持首次出现顺序；空字符串/纯空白名称跳过
    const uniqueTagNames = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))];

    for (const tagName of uniqueTagNames) {
        try {
            let tag = await client.knowledgeTag.findFirst({
                where: {
                    name: tagName,
                    tagSet,
                    OR: [
                        { isSystem: true },
                        { userId },
                    ],
                },
            });

            if (!tag) {
                const parentId = await findParentTagIdForGrade(gradeSemester, subjectKey, client, tagSet);
                logger.debug({ tagName, parentId, subjectKey, tagSet }, 'Creating new custom tag');

                tag = await client.knowledgeTag.create({
                    data: {
                        name: tagName,
                        subject: subjectKey,
                        isSystem: false,
                        userId,
                        parentId: parentId,
                        tagSet,
                    },
                });
                logger.debug({ tagId: tag.id, tagName }, 'Custom tag created');
            } else {
                logger.debug({ tagId: tag.id, tagName, isSystem: tag.isSystem }, 'Existing tag found');
            }

            tagConnections.push({ id: tag.id });
        } catch (tagError) {
            logger.error({ tagName, error: tagError }, 'Error processing tag');
            throw tagError;
        }
    }

    return tagConnections;
}

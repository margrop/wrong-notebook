/**
 * 知识点标签 API
 * GET /api/tags - 获取标签树
 * POST /api/tags - 创建自定义标签
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import type { KnowledgeTag } from '@prisma/client';

const logger = createLogger('api:tags');

interface TagTreeNode {
    id: string;
    name: string;
    code: string | null;
    isSystem: boolean;
    children: TagTreeNode[];
}

/**
 * 构建标签树
 */
function buildTagTree(tags: KnowledgeTag[]): TagTreeNode[] {
    const tagMap = new Map<string, TagTreeNode>();
    const roots: TagTreeNode[] = [];

    // 第一遍：创建所有节点
    for (const tag of tags) {
        tagMap.set(tag.id, {
            id: tag.id,
            name: tag.name,
            code: tag.code,
            isSystem: tag.isSystem,
            children: [],
        });
    }

    // 第二遍：建立父子关系
    for (const tag of tags) {
        const node = tagMap.get(tag.id)!;
        if (tag.parentId && tagMap.has(tag.parentId)) {
            tagMap.get(tag.parentId)!.children.push(node);
        } else {
            roots.push(node);
        }
    }

    return roots;
}

/**
 * GET /api/tags
 * Query params:
 *   - subject: 学科 (必填, e.g., 'math')
 *   - tagSet: 标签体系 (可选, 默认 'default')
 *   - flat: 是否返回扁平列表 (可选, 默认 false 返回树)
 *   - tagSetsOnly: 是否只返回可用标签体系列表 (可选, 默认 false)
 */
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const subject = searchParams.get('subject');
        const tagSet = searchParams.get('tagSet') || 'default';
        const flat = searchParams.get('flat') === 'true';
        const tagSetsOnly = searchParams.get('tagSetsOnly') === 'true';

        // 只查询可用标签体系列表
        if (tagSetsOnly) {
            const tagSets = await prisma.knowledgeTag.findMany({
                where: { isSystem: true },
                select: { tagSet: true },
                distinct: ['tagSet'],
            });
            return NextResponse.json({ tagSets: tagSets.map(t => t.tagSet) });
        }

        if (!subject) {
            return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
        }

        // 获取系统标签 + 当前用户的自定义标签
        const tags = await prisma.knowledgeTag.findMany({
            where: {
                subject,
                tagSet,
                OR: [
                    { isSystem: true },
                    { userId: session.user.id },
                ],
            },
            orderBy: [
                { order: 'asc' },
                { name: 'asc' },
            ],
        });

        if (flat) {
            // 返回扁平列表 (仅叶子节点，即实际的知识点)
            const leafTags = tags.filter(t =>
                !tags.some(other => other.parentId === t.id)
            );
            return NextResponse.json({
                tags: leafTags.map(t => {
                    const parent = t.parentId ? tags.find(p => p.id === t.parentId) : null;
                    return {
                        id: t.id,
                        name: t.name,
                        isSystem: t.isSystem,
                        parentId: t.parentId,
                        parentName: parent ? parent.name : null,
                    };
                }),
            });
        }

        // 返回树状结构
        const tree = buildTagTree(tags);
        if (tags.length > 0) {
            logger.debug({
                subject,
                tagSet,
                totalTags: tags.length,
                systemTags: tags.filter(t => t.isSystem).length,
                userTags: tags.filter(t => !t.isSystem).length,
                treeRoots: tree.length,
                sampleRoot: tree.length > 0 ? tree[0].name : 'none'
            }, 'Returning tag tree');
        }
        return NextResponse.json({ tags: tree });

    } catch (error) {
        logger.error({ error }, 'Error fetching tags');
        return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
    }
}

/**
 * POST /api/tags
 * Body: { name: string, subject: string, parentId?: string }
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { name, subject, parentId } = body;

        if (!name || !subject) {
            return NextResponse.json({ error: 'Name and subject are required' }, { status: 400 });
        }

        // 检查是否已存在 (在同一父节点下)
        // 注意：Prisma对于可选字段的查询需要特殊处理。如果是null，必须显式指定。
        const existing = await prisma.knowledgeTag.findFirst({
            where: {
                name: name.trim(),
                subject,
                userId: session.user.id,
                parentId: parentId || null,
            },
        });

        if (existing) {
            return NextResponse.json({ error: 'Tag already exists in this group' }, { status: 409 });
        }

        // 创建自定义标签
        const tag = await prisma.knowledgeTag.create({
            data: {
                name: name.trim(),
                subject,
                parentId: parentId || null,
                isSystem: false,
                userId: session.user.id,
            },
        });

        return NextResponse.json({ tag }, { status: 201 });

    } catch (error) {
        logger.error({ error }, 'Error creating tag');
        return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
    }
}

/**
 * DELETE /api/tags
 * Query params: id (tag ID to delete)
 * Only allows deleting user's own custom tags
 */
export async function DELETE(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const tagId = searchParams.get('id');

        if (!tagId) {
            return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 });
        }

        // 只能删除自己的自定义标签
        const tag = await prisma.knowledgeTag.findFirst({
            where: {
                id: tagId,
                userId: session.user.id,
                isSystem: false,
            },
        });

        if (!tag) {
            return NextResponse.json({ error: 'Tag not found or not deletable' }, { status: 404 });
        }

        await prisma.knowledgeTag.delete({
            where: { id: tagId },
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        logger.error({ error }, 'Error deleting tag');
        return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
    }
}

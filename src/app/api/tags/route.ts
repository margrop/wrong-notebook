/**
 * 知识点标签 API
 * GET /api/tags - 获取标签树
 * POST /api/tags - 创建自定义标签
 * DELETE /api/tags - 删除自定义标签
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withUser } from '@/lib/api-handler';
import type { AuthenticatedContext } from '@/lib/api-handler';
import { createTagSchema, deleteTagQuerySchema } from '@/lib/schemas/tags';
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
async function handleGet(request: NextRequest, { user }: AuthenticatedContext) {
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
                { userId: user.id },
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
}

export const GET = withUser(async (req, ctx) => {
    try {
        return await handleGet(req as NextRequest, ctx);
    } catch (error) {
        logger.error({ error }, 'Error fetching tags');
        return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
    }
});

/**
 * POST /api/tags
 * Body: { name: string, subject: string, parentId?: string, tagSet?: string }
 * tagSet 缺省为 'default'；父节点必须属于同一学科和同一标签体系
 */
async function handlePost(request: NextRequest, { user }: AuthenticatedContext) {
    const parsed = createTagSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        if (issue?.path[0] === 'parentId') {
            return NextResponse.json({ error: 'Invalid parentId' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Name and subject are required' }, { status: 400 });
    }
    const { name, subject, parentId } = parsed.data;
    const tagSet = parsed.data.tagSet?.trim() || 'default';

    // 父节点须是同一学科、同一体系下当前用户可见的标签，避免挂到其他体系或别人的标签下
    if (parentId) {
        const parent = await prisma.knowledgeTag.findFirst({
            where: {
                id: parentId,
                subject,
                tagSet,
                OR: [{ isSystem: true }, { userId: user.id }],
            },
            select: { id: true },
        });
        if (!parent) {
            return NextResponse.json({ error: 'Parent tag not found in this tag set' }, { status: 400 });
        }
    }

    // 检查是否已存在 (在同一父节点下)
    // 注意：Prisma对于可选字段的查询需要特殊处理。如果是null，必须显式指定。
    const existing = await prisma.knowledgeTag.findFirst({
        where: {
            name: name.trim(),
            subject,
            userId: user.id,
            parentId: parentId || null,
            tagSet,
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
            userId: user.id,
            tagSet,
        },
    });

    return NextResponse.json({ tag }, { status: 201 });
}

export const POST = withUser(async (req, ctx) => {
    try {
        return await handlePost(req as NextRequest, ctx);
    } catch (error) {
        logger.error({ error }, 'Error creating tag');
        return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
    }
});

/**
 * DELETE /api/tags
 * Query params: id (tag ID to delete)
 * Only allows deleting user's own custom tags
 */
async function handleDelete(request: NextRequest, { user }: AuthenticatedContext) {
    const { searchParams } = new URL(request.url);
    const parsed = deleteTagQuerySchema.safeParse({ id: searchParams.get('id') });
    if (!parsed.success) {
        return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 });
    }
    const { id: tagId } = parsed.data;

    // 只能删除自己的自定义标签
    const tag = await prisma.knowledgeTag.findFirst({
        where: {
            id: tagId,
            userId: user.id,
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
}

export const DELETE = withUser(async (req, ctx) => {
    try {
        return await handleDelete(req as NextRequest, ctx);
    } catch (error) {
        logger.error({ error }, 'Error deleting tag');
        return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
    }
});

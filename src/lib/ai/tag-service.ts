/**
 * 从数据库获取 AI 分析所需的标签
 * 替代原有的 getMathTagsByGrade 函数
 */

import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import type { CandidateTags, GradeLevel } from './types';
import { isGradeInStage, SUBJECT_DISPLAY_NAMES, type NotebookScope, type NotebookStage, type NotebookSubject } from '@/lib/notebook-scope';

const logger = createLogger('ai:tag-service');

/**
 * 从数据库获取指定年级的数学标签
 * @param grade - 年级 (1-6:小学, 7-9:初中, 10-12:高中) 或 null
 * @param tagSet - 标签体系 (默认 'default')
 * @returns 标签名称数组
 */
export async function getMathTagsFromDB(grade: GradeLevel | null, tagSet: string = 'default'): Promise<string[]> {
    const gradeToSemesterMap: Record<number, string[]> = {
        1: ['一年级'],
        2: ['二年级'],
        3: ['三年级'],
        4: ['四年级'],
        5: ['五年级'],
        6: ['六年级'],
        7: ['七年级上', '七年级下'],
        8: ['八年级上', '八年级下'],
        9: ['九年级上', '九年级下'],
        10: ['高一上', '高一下'],
        11: ['高二上', '高二下'],
        12: ['高三上', '高三下', '高三'],
    };

    // 确定要查询的年级学期
    const semesterNames: string[] = [];

    if (!grade) {
        // 无年级信息，返回初中和高中全部标签（与以往行为一致，不含小学）
        for (let g = 7; g <= 12; g++) {
            semesterNames.push(...gradeToSemesterMap[g]);
        }
    } else if (grade <= 6) {
        // 小学累进式：一年级到当前年级（含课内与课外拓展）
        for (let g = 1; g <= grade; g++) {
            semesterNames.push(...gradeToSemesterMap[g]);
        }
    } else if (grade >= 7 && grade <= 9) {
        // 初中累进式：当前年级及之前
        for (let g = 7; g <= grade; g++) {
            semesterNames.push(...(gradeToSemesterMap[g] || []));
        }
    } else {
        // 高中累进式：从高一开始
        for (let g = 10; g <= grade; g++) {
            semesterNames.push(...(gradeToSemesterMap[g] || []));
        }
    }

    try {
        // 获取所有顶层节点（年级学期）
        const topLevelTags = await prisma.knowledgeTag.findMany({
            where: {
                subject: 'math',
                parentId: null,
                tagSet,
                name: { in: semesterNames },
            },
            select: { id: true },
        });

        const topLevelIds = topLevelTags.map(t => t.id);

        // 递归获取所有叶子节点标签
        const allTags = await prisma.knowledgeTag.findMany({
            where: {
                subject: 'math',
                isSystem: true,
                tagSet,
            },
            select: {
                id: true,
                name: true,
                parentId: true,
            },
        });

        // 构建父子关系映射
        const childMap = new Map<string, string[]>();
        allTags.forEach(tag => {
            if (tag.parentId) {
                const children = childMap.get(tag.parentId) || [];
                children.push(tag.id);
                childMap.set(tag.parentId, children);
            }
        });

        // 递归收集所有后代ID
        const collectDescendants = (nodeId: string): string[] => {
            const children = childMap.get(nodeId) || [];
            if (children.length === 0) return [nodeId]; // 叶子节点
            return children.flatMap(cid => collectDescendants(cid));
        };

        // 收集所有目标年级的叶子节点
        const leafIds = new Set<string>();
        topLevelIds.forEach(id => {
            collectDescendants(id).forEach(leafId => leafIds.add(leafId));
        });

        // 获取叶子节点名称
        const tagNameMap = new Map(allTags.map(t => [t.id, t.name]));
        const result = Array.from(leafIds)
            .map(id => tagNameMap.get(id))
            .filter((name): name is string => !!name);

        return result;
    } catch (error) {
        logger.error({ error }, 'getMathTagsFromDB error');
        return [];
    }
}

/**
 * 从数据库获取指定学科的标签
 * @param subject - 学科 (math, physics, chemistry, english, etc.)
 * @param tagSet - 标签体系 (默认 'default')
 * @returns 标签名称数组
 */
export async function getTagsFromDB(subject: string, tagSet: string = 'default'): Promise<string[]> {
    try {
        const tags = await prisma.knowledgeTag.findMany({
            where: {
                subject,
                isSystem: true,
                tagSet,
                // 只获取叶子节点
                children: { none: {} },
            },
            select: { name: true },
            orderBy: { order: 'asc' },
        });

        return tags.map(t => t.name);
    } catch (error) {
        logger.error({ error }, 'getTagsFromDB error');
        return [];
    }
}

/**
 * 获取某学科、某学段、某标签体系下的全部知识点（该学段所有年级节点下的叶子标签，按名称去重，保持标签库顺序）
 */
export async function getScopeTagsFromDB(subject: NotebookSubject, stage: NotebookStage, tagSet: string = 'default'): Promise<string[]> {
    try {
        const tags = await prisma.knowledgeTag.findMany({
            where: { subject, isSystem: true, tagSet },
            select: { id: true, name: true, parentId: true },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        });

        const children = new Map<string, typeof tags>();
        for (const tag of tags) {
            if (tag.parentId) {
                const list = children.get(tag.parentId) || [];
                list.push(tag);
                children.set(tag.parentId, list);
            }
        }

        const names = new Set<string>();
        const collect = (tag: (typeof tags)[number]) => {
            const kids = children.get(tag.id);
            if (!kids?.length) {
                names.add(tag.name);
                return;
            }
            kids.forEach(collect);
        };
        // 年级节点只是分类，没有子节点时（如尚无知识点的「大一」）不能当成知识点
        tags.filter((tag) => !tag.parentId && isGradeInStage(tag.name, stage) && children.has(tag.id)).forEach(collect);
        return Array.from(names);
    } catch (error) {
        logger.error({ error, subject, stage, tagSet }, 'getScopeTagsFromDB error');
        return [];
    }
}

/**
 * 该用户在本学科、本标签体系下自己建的叶子标签（含没有年级父节点的根标签），
 * 只保留隶属于该学段年级节点的，保证不同学段互不串标签。
 */
export async function getUserScopeTagsFromDB(subject: NotebookSubject, stage: NotebookStage, tagSet: string, userId: string): Promise<string[]> {
    try {
        const tags = await prisma.knowledgeTag.findMany({
            where: { subject, tagSet, OR: [{ isSystem: true }, { userId }] },
            select: { id: true, name: true, parentId: true, isSystem: true },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        });
        const byId = new Map(tags.map((tag) => [tag.id, tag]));
        const withChildren = new Set(tags.flatMap((tag) => (tag.parentId ? [tag.parentId] : [])));

        const names = new Set<string>();
        for (const tag of tags) {
            if (tag.isSystem || withChildren.has(tag.id)) continue;
            let root = tag;
            const visited = new Set([tag.id]);
            while (root.parentId && byId.has(root.parentId) && !visited.has(root.parentId)) {
                root = byId.get(root.parentId)!;
                visited.add(root.id);
            }
            // 根节点就是标签自己时视为无年级归属的自定义标签，一并作为候选
            if (root.id === tag.id || isGradeInStage(root.name, stage)) names.add(tag.name);
        }
        return Array.from(names);
    } catch (error) {
        logger.error({ error, subject, stage, tagSet }, 'getUserScopeTagsFromDB error');
        return [];
    }
}

/**
 * 错题本学段 + 学科 + 标签体系对应的候选知识点（直接交给 AI，不再按年级计算范围）。
 * 该学段没有内置课程知识点时（如大学）标记 allowCustom，并把该错题本已有的用户标签作为优先复用清单。
 */
export async function getNotebookCandidateTags(scope: NotebookScope, tagSet: string = 'default', userId?: string): Promise<CandidateTags | undefined> {
    if (!scope.subject) return undefined;
    const systemTags = await getScopeTagsFromDB(scope.subject, scope.stage, tagSet);
    const allowCustom = systemTags.length === 0;
    const tags = allowCustom && userId
        ? await getUserScopeTagsFromDB(scope.subject, scope.stage, tagSet, userId)
        : systemTags;
    return {
        subjectName: SUBJECT_DISPLAY_NAMES[scope.subject],
        tags,
        ...(allowCustom ? { allowCustom: true } : {}),
    };
}

/**
 * 未指定错题本时的候选标签：数学按学生年级取标签，其他学科取该学科全部知识点；
 * 未知学科时各科都取，让 AI 判断后再按学科过滤。
 */
export async function prefetchSubjectTags(subject: string | null | undefined, grade: GradeLevel | null | undefined, tagSet: string = 'default') {
    return {
        prefetchedMathTags: (subject === '数学' || !subject) ? await getMathTagsFromDB(grade || null, tagSet) : [],
        prefetchedScienceTags: (subject === '科学' || !subject) ? await getTagsFromDB('science', tagSet) : [],
        prefetchedPhysicsTags: (subject === '物理' || !subject) ? await getTagsFromDB('physics', tagSet) : [],
        prefetchedChemistryTags: (subject === '化学' || !subject) ? await getTagsFromDB('chemistry', tagSet) : [],
        prefetchedBiologyTags: (subject === '生物' || !subject) ? await getTagsFromDB('biology', tagSet) : [],
        prefetchedEnglishTags: (subject === '英语' || !subject) ? await getTagsFromDB('english', tagSet) : [],
        prefetchedChineseTags: (subject === '语文' || !subject) ? await getTagsFromDB('chinese', tagSet) : [],
        prefetchedHistoryTags: (subject === '历史' || !subject) ? await getTagsFromDB('history', tagSet) : [],
        prefetchedGeographyTags: (subject === '地理' || !subject) ? await getTagsFromDB('geography', tagSet) : [],
        prefetchedPoliticsTags: (subject === '政治' || !subject) ? await getTagsFromDB('politics', tagSet) : [],
    };
}

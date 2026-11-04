import type { Prisma } from "@prisma/client";
import { getAppTimeZone } from "@/lib/config";
import { shiftCalendarDate } from "@/lib/date-time";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/lib/constants/pagination";
import { isShortId } from "@/lib/short-id/short-id";
import { isMasteryStatus, masteryStatusWhere } from "@/lib/mastery-status";
import type { MasteryStatus } from "@/lib/mastery-status";
import type { TimeFilter, QuestionTypeFilterValue } from "@/lib/error-list/error-list-filters";
import { QUESTION_TYPE_NONE, parseQuestionTypeFilter } from "@/lib/error-list/error-list-filters";

/** 错题列表查询参数（解析自 URL searchParams） */
export interface ErrorListQueryParams {
    subjectId: string | null;
    query: string | null;
    mastery: MasteryStatus | null;
    timeRange: TimeFilter;
    tag: string | null;
    chapter: string | null;
    gradeSemester: string | null;
    paperLevel: string | null;
    questionTypes: QuestionTypeFilterValue[];
    view: string | null;
    page: number;
    pageSize: number;
}

/** buildErrorListWhere 依赖的数据库客户端接口，便于单测 mock */
export interface ErrorListQueryDeps {
    knowledgeTag: {
        findFirst(args: {
            where: { name: string; OR: ({ isSystem: boolean } | { userId: string })[] };
            select: { id: true };
        }): Promise<{ id: string } | null>;
        findMany(args: {
            where: { parentId: string };
            select: { id: true };
        }): Promise<{ id: string }[]>;
    };
}

/** 解析正整数，非数字时回退到默认值 */
function parsePositiveInt(raw: string | null, fallback: number): number {
    const value = parseInt(raw ?? "", 10);
    return Number.isNaN(value) ? fallback : value;
}

/** 把 URL searchParams 解析为强类型查询参数，非法分页值被夹紧到合法范围 */
export function parseErrorListQueryParams(searchParams: URLSearchParams): ErrorListQueryParams {
    const mastery = searchParams.get("mastery");
    const timeRange = searchParams.get("timeRange");
    const page = Math.max(1, parsePositiveInt(searchParams.get("page"), 1));
    const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(MIN_PAGE_SIZE, parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE))
    );
    return {
        subjectId: searchParams.get("subjectId"),
        query: searchParams.get("query"),
        mastery: isMasteryStatus(mastery) ? mastery : null,
        timeRange: timeRange === "week" || timeRange === "month" ? timeRange : "all",
        tag: searchParams.get("tag"),
        chapter: searchParams.get("chapter"),
        gradeSemester: searchParams.get("gradeSemester"),
        paperLevel: searchParams.get("paperLevel"),
        questionTypes: parseQuestionTypeFilter(searchParams.get("questionTypes")),
        view: searchParams.get("view"),
        page,
        pageSize,
    };
}

/**
 * 构造错题列表的 Prisma where 条件。
 * 查库部分（章节后代标签）通过 deps 传入的 prisma 客户端完成，便于单测 mock。
 */
export async function buildErrorListWhere(
    params: ErrorListQueryParams,
    userId: string,
    masteryThreshold: number,
    deps: ErrorListQueryDeps
): Promise<Prisma.ErrorItemWhereInput> {
    const whereClause: Prisma.ErrorItemWhereInput = { userId };

    if (params.subjectId) {
        whereClause.subjectId = params.subjectId;
    }

    // 搜索条件需要使用 AND 包装，避免与其他 OR 条件冲突
    // 最终的 whereClause.AND 会包含所有需要同时满足的条件
    const andConditions: Prisma.ErrorItemWhereInput[] = [];

    if (params.query) {
        // 搜索条件：在题目、解析、知识点中任一匹配即可
        andConditions.push({
            OR: [
                { questionText: { contains: params.query } },
                { analysis: { contains: params.query } },
                { wrongAnswerText: { contains: params.query } },
                { mistakeAnalysis: { contains: params.query } },
                { knowledgePoints: { contains: params.query } },
                ...(isShortId(params.query.trim()) ? [{ shortId: params.query.trim() }] : []),
            ]
        });
    }

    // 复习状态筛选：new 待复习 / reviewing 复习中 / mastered 已掌握
    if (params.mastery) {
        andConditions.push(masteryStatusWhere(params.mastery, masteryThreshold));
    }

    // Time range filter
    if (params.timeRange !== "all") {
        const now = new Date();
        const timeZone = getAppTimeZone();
        let startDate = now;

        if (params.timeRange === "week") {
            startDate = shiftCalendarDate(now, timeZone, -7);
        } else if (params.timeRange === "month") {
            startDate = shiftCalendarDate(now, timeZone, 0, -1);
        }

        whereClause.createdAt = {
            gte: startDate,
        };
    }

    // Chapter filter (第二级筛选：章节)
    // 如果指定了 chapter，需要找到该章节下所有子标签的 ID，然后过滤错题
    if (params.chapter) {
        // 查找该章节标签及其所有后代的ID
        const chapterTagIds = await findChapterDescendantTagIds(params.chapter, userId, deps);
        if (chapterTagIds.length > 0) {
            whereClause.tags = {
                some: {
                    id: { in: chapterTagIds }
                }
            };
        } else {
            // 章节不存在或没有子标签，应返回空结果
            // 但为了不破坏其他条件，我们添加一个必然为假的条件
            whereClause.id = "__IMPOSSIBLE_ID__";
        }
    }

    // Tag filter (第三级筛选：具体知识点)
    if (params.tag && !params.chapter) {
        // 按标签名精确匹配。knowledgePoints 是 JSON 数组字符串，
        // 只能带引号匹配完整元素，否则筛「函数」会把「二次函数」也筛出来；
        // 保留它是为了兼容尚未迁移到 tags 关系的旧错题。
        andConditions.push({
            OR: [
                { tags: { some: { name: params.tag } } },
                { knowledgePoints: { contains: JSON.stringify(params.tag) } },
            ],
        });
    } else if (params.tag && params.chapter) {
        // 如果同时有 chapter 和 tag，优先用 tag 进一步过滤
        // 覆盖 chapter 的条件
        whereClause.tags = {
            some: {
                name: params.tag
            }
        };
    }

    // Grade/Semester filter
    if (params.gradeSemester) {
        const gradeFilter = buildGradeFilter(params.gradeSemester);
        if (gradeFilter) {
            // Merge into main whereClause
            Object.assign(whereClause, gradeFilter);
        }
    }

    // Paper Level filter
    if (params.paperLevel && params.paperLevel !== "all") {
        whereClause.paperLevel = params.paperLevel;
    }

    // 题型多选筛选：选 "none" 时包含未设置题型的题，与其他已选题型取 OR
    if (params.questionTypes.length > 0) {
        const typeConditions: Prisma.ErrorItemWhereInput[] = [];
        const concreteTypes = params.questionTypes.filter(
            (value): value is Exclude<QuestionTypeFilterValue, typeof QUESTION_TYPE_NONE> => value !== QUESTION_TYPE_NONE
        );
        if (concreteTypes.length > 0) {
            typeConditions.push({ questionType: { in: concreteTypes } });
        }
        if (params.questionTypes.includes(QUESTION_TYPE_NONE)) {
            typeConditions.push({ questionType: null });
        }
        andConditions.push({ OR: typeConditions });
    }

    // 将所有 AND 条件合并到 whereClause
    if (andConditions.length > 0) {
        whereClause.AND = andConditions;
    }

    return whereClause;
}

/** 年级学期筛选条件（含别名映射），纯函数便于单测 */
export function buildGradeFilter(gradeSemester: string): Prisma.ErrorItemWhereInput {
    // 1. 恢复别名映射表 (Support aliases like 初一 for 七年级)
    const gradeMap: Record<string, string[]> = {
        "七年级": ["七年级", "初一", "7年级", "七"],
        "八年级": ["八年级", "初二", "8年级", "八"],
        "九年级": ["九年级", "初三", "9年级", "九"],
        "高一": ["高一", "10年级"],
        "高二": ["高二", "11年级"],
        "高三": ["高三", "12年级"],
    };

    // 2. 解析输入
    let targetGrades: string[] = [gradeSemester]; // Default fallback
    let targetSemester = "";

    // 提取年级关键字
    let foundKey = "";
    if (gradeSemester.includes("七年级") || gradeSemester.includes("初一")) foundKey = "七年级";
    else if (gradeSemester.includes("八年级") || gradeSemester.includes("初二")) foundKey = "八年级";
    else if (gradeSemester.includes("九年级") || gradeSemester.includes("初三")) foundKey = "九年级";
    else if (gradeSemester.includes("高一")) foundKey = "高一";
    else if (gradeSemester.includes("高二")) foundKey = "高二";
    else if (gradeSemester.includes("高三")) foundKey = "高三";
    else {
        // 如果无法识别标准年级，尝试直接解析前缀 (e.g. "一年级")
        const match = gradeSemester.match(/^(.+?)[上下]/);
        if (match) {
            targetGrades = [match[1]]; // e.g. "一年级"
        } else {
            // 完全完全无法解析，直接模糊匹配原字符串
            return { gradeSemester: { contains: gradeSemester } };
        }
    }

    if (foundKey) {
        targetGrades = gradeMap[foundKey];
    }

    // 提取学期
    if (gradeSemester.includes("上")) targetSemester = "上";
    else if (gradeSemester.includes("下")) targetSemester = "下";

    // 3. 构建多重组合查询条件
    // 对每一个可能的别名，生成多种格式变体
    const orConditions: Prisma.ErrorItemWhereInput[] = [];

    targetGrades.forEach(grade => {
        // 变体 1: 仅年级 (如果没有学期限制)
        if (!targetSemester) {
            orConditions.push({ gradeSemester: { contains: grade } });
        } else {
            // 变体 2: 年级 + 学期 (包含多种连接符)
            // 紧凑型: "初一上"
            orConditions.push({ gradeSemester: { contains: `${grade}${targetSemester}` } });
            // 逗号型: "初一，上" 或 "初一，上期"
            // 由于 contains 的特性，我们不需要穷举 "上期"/"上学期"，只要包含 "grade" 和 "学期关键字" 即可
            // 但 Prisma 的 AND 逻辑更适合处理这种情况
            // Let's use specific composed strings for precision if possible, or broad AND

            // 下面的逻辑能匹配 "初一，上期" (因为包含 "初一" 和 "，"?? 不，contains 是子串)
            // 这种组合 "grade + 任意字符 + semester" 很难用一个 contains 表达。
            // 简单粗暴点：
            orConditions.push({ gradeSemester: { contains: `${grade}，${targetSemester}` } }); // 中文逗号
            orConditions.push({ gradeSemester: { contains: `${grade},${targetSemester}` } }); // 英文逗号
            orConditions.push({ gradeSemester: { contains: `${grade} ${targetSemester}` } }); // 空格

            // 针对 "上期" 的特殊处理 (旧数据的 "高一，上期")
            const semesterTerm = targetSemester === '上' ? '上期' : '下期';
            orConditions.push({ gradeSemester: { contains: `${grade}，${semesterTerm}` } });
        }
    });

    if (orConditions.length === 0) {
        return { gradeSemester: { contains: gradeSemester } };
    }

    return { OR: orConditions };
}

// 查找章节标签及其所有后代标签的 ID
async function findChapterDescendantTagIds(
    chapterName: string,
    userId: string,
    deps: ErrorListQueryDeps
): Promise<string[]> {
    // 1. 找到章节标签本身 (系统标签或用户自定义标签)
    const chapterTag = await deps.knowledgeTag.findFirst({
        where: {
            name: chapterName,
            OR: [
                { isSystem: true },
                { userId: userId },
            ],
        },
        select: { id: true }
    });

    if (!chapterTag) return [];

    // 2. 递归查找所有后代标签
    const descendantIds: string[] = [chapterTag.id];
    const queue: string[] = [chapterTag.id];

    while (queue.length > 0) {
        const parentId = queue.shift()!;
        const children = await deps.knowledgeTag.findMany({
            where: { parentId: parentId },
            select: { id: true }
        });
        for (const child of children) {
            descendantIds.push(child.id);
            queue.push(child.id);
        }
    }

    return descendantIds;
}

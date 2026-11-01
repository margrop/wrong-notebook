import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, badRequest, validationError, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { DEFAULT_EXAM_PICK_RULE, EXAM_DIFFICULTIES, EXAM_PICK_RULES, EXAM_SCOPES, MAX_EXAM_QUESTIONS, generateExamPaper, selectSourceItems } from "@/lib/exam";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { consumeAiQuota } from "@/lib/ai-quota";

const logger = createLogger('api:exams');

const createSchema = z.object({
    subjectIds: z.array(z.string().min(1)).min(1).max(50),
    tagNames: z.array(z.string().trim().min(1)).max(50).optional(),
    paperLevelIds: z.array(z.string().min(1)).max(20).optional(),
    scope: z.enum(EXAM_SCOPES),
    count: z.number().int().min(1).max(MAX_EXAM_QUESTIONS),
    pickRule: z.enum(EXAM_PICK_RULES).default(DEFAULT_EXAM_PICK_RULE),
    difficulty: z.enum(EXAM_DIFFICULTIES),
    title: z.string().trim().max(100).optional(),
    language: z.enum(['zh', 'en']).optional(),
});

/**
 * GET /api/exams
 * 当前用户的试卷列表（按创建时间倒序）
 */
export async function GET() {
    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const papers = await prisma.examPaper.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                status: true,
                scope: true,
                difficulty: true,
                requestedCount: true,
                resultsRecordedAt: true,
                createdAt: true,
                questions: { select: { status: true, _count: { select: { practiceRecords: true } } } },
            },
        });

        return NextResponse.json(papers.map(({ questions, ...paper }) => ({
            ...paper,
            questionCount: questions.length,
            readyCount: questions.filter((question) => question.status === 'ready').length,
            recordedCount: questions.filter((question) => question._count.practiceRecords > 0).length,
        })));
    } catch (error) {
        logger.error({ error }, 'Error listing exam papers');
        return internalError("Failed to list exam papers");
    }
}

/**
 * POST /api/exams
 * 按条件与抽题规则（默认优先练习较少的题目）抽取错题，创建试卷并在后台生成举一反三题目
 */
export async function POST(req: Request) {
    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const parsed = createSchema.safeParse(await req.json());
        if (!parsed.success) {
            return validationError("Invalid exam options", parsed.error.issues);
        }
        const { subjectIds, tagNames, paperLevelIds, scope, count, pickRule, difficulty, language } = parsed.data;

        // 只允许使用自己的错题本
        const notebooks = await prisma.subject.findMany({
            where: { id: { in: subjectIds }, userId: user.id },
            select: { id: true, name: true },
        });
        if (notebooks.length === 0) {
            return badRequest("NO_SOURCE_ITEMS");
        }

        // 校验卷别分组属于当前用户
        if (paperLevelIds && paperLevelIds.length > 0) {
            const validGroups = await prisma.paperGroup.count({
                where: { id: { in: paperLevelIds }, userId: user.id },
            });
            if (validGroups !== paperLevelIds.length) {
                return validationError("Invalid paperLevelIds", [{ code: 'invalid_paper_level', path: ['paperLevelIds'], message: 'Invalid paper level group' }]);
            }
        }

        const sources = await selectSourceItems(user.id, {
            subjectIds: notebooks.map((notebook) => notebook.id),
            tagNames,
            paperLevelIds,
            scope,
            count,
            pickRule,
        });
        if (sources.length === 0) {
            return badRequest("NO_SOURCE_ITEMS");
        }

        const title = parsed.data.title
            || `${notebooks.map((notebook) => notebook.name).join('、')} ${formatDateTime(new Date(), 'yyyy-MM-dd HH:mm', getAppTimeZone())}`;

        const limited = await consumeAiQuota(user, 'exam');
        if (limited) return limited;

        const paper = await prisma.examPaper.create({
            data: {
                userId: user.id,
                title,
                scope,
                difficulty,
                requestedCount: count,
                subjectIds: JSON.stringify(notebooks.map((notebook) => notebook.id)),
                tagNames: tagNames && tagNames.length > 0 ? JSON.stringify(tagNames) : null,
                questions: {
                    create: sources.map((source, index) => ({
                        order: index + 1,
                        errorItemId: source.id,
                        sourceShortId: source.shortId!,
                    })),
                },
            },
            select: { id: true, title: true, requestedCount: true, _count: { select: { questions: true } } },
        });

        void generateExamPaper(paper.id, language || 'zh');

        logger.info({ paperId: paper.id, count: sources.length, requested: count }, 'Exam paper created');
        return NextResponse.json({
            id: paper.id,
            title: paper.title,
            requestedCount: paper.requestedCount,
            questionCount: paper._count.questions,
        }, { status: 201 });
    } catch (error) {
        logger.error({ error }, 'Error creating exam paper');
        return internalError("Failed to create exam paper");
    }
}

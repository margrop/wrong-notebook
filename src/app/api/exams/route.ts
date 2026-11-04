import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, validationError, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { DEFAULT_EXAM_PICK_RULE, EXAM_DIFFICULTIES, EXAM_MODES, EXAM_PICK_RULES, EXAM_SCOPES, MAX_EXAM_QUESTIONS, generateExamPaper, selectSourceItems, snapshotOriginalQuestion } from "@/lib/exam/exam";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:exams');

const createSchema = z.object({
    subjectIds: z.array(z.string().min(1)).min(1).max(50),
    tagNames: z.array(z.string().trim().min(1)).max(50).optional(),
    paperLevelIds: z.array(z.string().min(1)).max(20).optional(),
    scope: z.enum(EXAM_SCOPES),
    count: z.number().int().min(1).max(MAX_EXAM_QUESTIONS),
    pickRule: z.enum(EXAM_PICK_RULES).default(DEFAULT_EXAM_PICK_RULE),
    difficulty: z.enum(EXAM_DIFFICULTIES).optional(),
    mode: z.enum(EXAM_MODES).default('generate'),
    title: z.string().trim().max(100).optional(),
    language: z.enum(['zh', 'en']).optional(),
});

/**
 * GET /api/exams
 * 当前用户的试卷列表（按创建时间倒序）
 */
export const GET = withUser(async (_req: Request, { user }: AuthenticatedContext) => {
    try {
        const papers = await prisma.examPaper.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                status: true,
                scope: true,
                difficulty: true,
                mode: true,
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
});

/**
 * POST /api/exams
 * 按条件与抽题规则（默认优先练习较少的题目）抽取错题，创建试卷并在后台生成举一反三题目
 */
export const POST = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    try {
        const parsed = createSchema.safeParse(await req.json());
        if (!parsed.success) {
            return validationError("Invalid exam options", parsed.error.issues);
        }
        const { subjectIds, tagNames, paperLevelIds, scope, count, pickRule, difficulty, mode, language } = parsed.data;

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
            requireQuestionText: mode === 'original',
        });
        if (sources.length === 0) {
            return badRequest("NO_SOURCE_ITEMS");
        }

        const title = parsed.data.title
            || `${notebooks.map((notebook) => notebook.name).join('、')} ${formatDateTime(new Date(), 'yyyy-MM-dd HH:mm', getAppTimeZone())}`;

        if (mode === 'original') {
            // 原题直出：不消耗 AI 额度，直接复制原题快照，试卷立即可打印
            const items = await prisma.errorItem.findMany({
                where: { id: { in: sources.map((s) => s.id) } },
                select: {
                    id: true,
                    shortId: true,
                    questionText: true,
                    answerText: true,
                    analysis: true,
                    figureSvg: true,
                    figureScale: true,
                    figureAlign: true,
                    answerSpacePx: true,
                },
            });
            // 按抽题顺序（sources）重排，保持 least_practiced / random 的优先级
            const itemMap = new Map(items.map((item) => [item.id, item]));
            const orderedItems = sources.map((s) => itemMap.get(s.id)!).filter(Boolean);
            const paper = await prisma.examPaper.create({
                data: {
                    userId: user.id,
                    title,
                    status: 'ready',
                    scope,
                    difficulty: 'original',
                    mode: 'original',
                    requestedCount: count,
                    subjectIds: JSON.stringify(notebooks.map((notebook) => notebook.id)),
                    tagNames: tagNames && tagNames.length > 0 ? JSON.stringify(tagNames) : null,
                    questions: {
                        create: orderedItems.map((item, index) => ({
                            order: index + 1,
                            errorItemId: item.id,
                            sourceShortId: item.shortId!,
                            ...snapshotOriginalQuestion(item),
                        })),
                    },
                },
                select: { id: true, title: true, requestedCount: true, _count: { select: { questions: true } } },
            });
            logger.info({ paperId: paper.id, count: sources.length, requested: count, mode: 'original' }, 'Original exam paper created');
            return NextResponse.json({
                id: paper.id,
                title: paper.title,
                requestedCount: paper.requestedCount,
                questionCount: paper._count.questions,
            }, { status: 201 });
        }

        // 举一反三模式（默认）：消耗 AI 额度并在后台生成新题
        if (!difficulty) {
            return validationError("Difficulty is required for generate mode", [{ code: 'required', path: ['difficulty'], message: 'Difficulty is required' }]);
        }
        const limited = await consumeAiQuota(user, 'exam');
        if (limited) return limited;

        const paper = await prisma.examPaper.create({
            data: {
                userId: user.id,
                title,
                scope,
                difficulty,
                mode: 'generate',
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
});

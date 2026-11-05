import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, validationError, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { DEFAULT_EXAM_PICK_RULE, EXAM_DIFFICULTIES, EXAM_MODES, EXAM_PICK_RULES, EXAM_SCOPES, MAX_EXAM_QUESTIONS, createExamPaperFromSources } from "@/lib/exam/exam";
import type { CreateExamPaperFromSourcesArgs } from "@/lib/exam/exam";
import { splitParallelSources } from "@/lib/exam/exam-parallel";
import { DEFAULT_EXAM_SOURCE, getExamSourceProvider } from "@/lib/exam/exam-sources";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { countBucket } from "@/lib/telemetry/schema";
import { recordEvent } from "@/lib/telemetry/server";

const logger = createLogger('api:exams');

const createSchema = z.object({
    subjectIds: z.array(z.string().min(1)).min(1).max(50),
    tagNames: z.array(z.string().trim().min(1)).max(50).optional(),
    paperLevelIds: z.array(z.string().min(1)).max(20).optional(),
    // 宽松：数组元素为字符串即可，未知题型 key 由 buildSourceWhere 忽略
    questionTypes: z.array(z.string()).max(20).optional(),
    scope: z.enum(EXAM_SCOPES),
    count: z.number().int().min(1).max(MAX_EXAM_QUESTIONS),
    pickRule: z.enum(EXAM_PICK_RULES).default(DEFAULT_EXAM_PICK_RULE),
    difficulty: z.enum(EXAM_DIFFICULTIES).optional(),
    mode: z.enum(EXAM_MODES).default('generate'),
    title: z.string().trim().max(100).optional(),
    language: z.enum(['zh', 'en']).optional(),
    source: z.string().trim().min(1).max(50).optional(),
    /** 同时生成 A/B 平行卷（两卷题目互不重复） */
    parallel: z.boolean().default(false),
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
        return internalError("Failed to list exam papers", { error, scope: "api:exams" });
    }
});

/**
 * POST /api/exams
 * 按条件与抽题规则（默认优先练习较少的题目）抽取错题，创建试卷并在后台生成举一反三题目
 */
export const POST = withUser(async (req: Request, context: AuthenticatedContext) => {
    const response = await createExam(req, context);
    // 匿名埋点：组卷成功（按题数分桶）或服务端失败；参数错误等 4xx 不记
    if (response.status === 201) {
        const body = await response.clone().json().catch(() => null) as { questionCount?: number } | null;
        void recordEvent("exam_paper_generation", { ok: true, count: countBucket(body?.questionCount ?? 1) });
    } else if (response.status >= 500) {
        void recordEvent("exam_paper_generation", { ok: false, count: "1" });
    }
    return response;
});

async function createExam(req: Request, { user }: AuthenticatedContext): Promise<Response> {
    try {
        const parsed = createSchema.safeParse(await req.json());
        if (!parsed.success) {
            return validationError("Invalid exam options", parsed.error.issues);
        }
        const { subjectIds, tagNames, paperLevelIds, questionTypes, scope, count, pickRule, difficulty, mode, language } = parsed.data;
        const parallel = parsed.data.parallel;
        const source = parsed.data.source ?? DEFAULT_EXAM_SOURCE;
        const provider = getExamSourceProvider(source);
        if (!provider) {
            return validationError("Unknown exam source", [{ code: 'invalid_source', path: ['source'], message: `Unknown exam source: ${source}` }]);
        }

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

        // A/B 卷一次多取最多 2×count 道互不重复的源题
        const sources = await provider.select(user.id, {
            subjectIds: notebooks.map((notebook) => notebook.id),
            tagNames,
            paperLevelIds,
            questionTypes,
            scope,
            count: parallel ? count * 2 : count,
            pickRule,
            requireQuestionText: mode === 'original',
            source,
        });
        if (sources.length === 0) {
            return badRequest("NO_SOURCE_ITEMS");
        }

        const baseTitle = parsed.data.title
            || `${notebooks.map((notebook) => notebook.name).join('、')} ${formatDateTime(new Date(), 'yyyy-MM-dd HH:mm', getAppTimeZone())}`;

        const buildPaperArgs = (title: string, selectedSources: typeof sources): CreateExamPaperFromSourcesArgs => ({
            userId: user.id,
            mode,
            title,
            scope,
            difficulty: difficulty ?? 'medium',
            requestedCount: count,
            subjectIdsJson: JSON.stringify(notebooks.map((notebook) => notebook.id)),
            tagNamesJson: tagNames && tagNames.length > 0 ? JSON.stringify(tagNames) : null,
            sources: selectedSources,
            language,
        });

        if (parallel) {
            const suffixA = language === 'en' ? ' (Paper A)' : '（A 卷）';
            const suffixB = language === 'en' ? ' (Paper B)' : '（B 卷）';
            const { paperA, paperB, warning } = splitParallelSources(sources, count);
            const papers = [];
            const bodyWarning = warning;
            let bodyError: string | undefined;

            if (mode === 'generate') {
                if (!difficulty) {
                    return validationError("Difficulty is required for generate mode", [{ code: 'required', path: ['difficulty'], message: 'Difficulty is required' }]);
                }
                // 举一反三模式：两卷分别消耗 AI 额度；B 卷额度不足时不创建并返回错误，A 卷保留
                const limitedA = await consumeAiQuota(user, 'exam');
                if (limitedA) return limitedA;
                const createdA = await createExamPaperFromSources({
                    ...buildPaperArgs(baseTitle + suffixA, paperA),
                    logLabel: 'Parallel exam paper A created',
                });
                papers.push({ id: createdA.id, title: createdA.title, questionCount: createdA._count.questions });
                const limitedB = await consumeAiQuota(user, 'exam');
                if (limitedB) {
                    // 第二卷额度不足：不创建 B 卷，A 卷保留
                    bodyError = 'PARALLEL_B_QUOTA_EXCEEDED';
                } else if (paperB.length > 0) {
                    const createdB = await createExamPaperFromSources({
                        ...buildPaperArgs(baseTitle + suffixB, paperB),
                        logLabel: 'Parallel exam paper B created',
                    });
                    papers.push({ id: createdB.id, title: createdB.title, questionCount: createdB._count.questions });
                }
            } else {
                // 原题直出：一次查询拿到 A、B 两卷所需的完整题目快照（在 createExamPaperFromSources 内按卷查询）
                const createdA = await createExamPaperFromSources({
                    ...buildPaperArgs(baseTitle + suffixA, paperA),
                    logLabel: 'Parallel exam paper A created',
                });
                papers.push({ id: createdA.id, title: createdA.title, questionCount: createdA._count.questions });
                if (paperB.length > 0) {
                    const createdB = await createExamPaperFromSources({
                        ...buildPaperArgs(baseTitle + suffixB, paperB),
                        logLabel: 'Parallel exam paper B created',
                    });
                    papers.push({ id: createdB.id, title: createdB.title, questionCount: createdB._count.questions });
                }
            }

            const first = papers[0];
            const body: Record<string, unknown> = {
                id: first.id,
                title: first.title,
                requestedCount: count,
                questionCount: first.questionCount,
                papers,
            };
            if (bodyWarning) body.warning = bodyWarning;
            if (bodyError) body.error = bodyError;
            return NextResponse.json(body, { status: 201 });
        }

        if (mode === 'original') {
            const paper = await createExamPaperFromSources({
                ...buildPaperArgs(baseTitle, sources),
                logLabel: 'Original exam paper created',
            });
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

        const paper = await createExamPaperFromSources(buildPaperArgs(baseTitle, sources));
        return NextResponse.json({
            id: paper.id,
            title: paper.title,
            requestedCount: paper.requestedCount,
            questionCount: paper._count.questions,
        }, { status: 201 });
    } catch (error) {
        logger.error({ error }, 'Error creating exam paper');
        return internalError("Failed to create exam paper", { error, scope: "api:exams" });
    }
}

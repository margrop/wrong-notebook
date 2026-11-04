import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { getAIService } from "@/lib/ai";
import { badRequest, notFound, internalError, taskAlreadyRunning } from "@/lib/api-errors";
import { generatePracticeSchema } from "@/lib/schemas/practice";
import { createLogger } from "@/lib/logger";
import { describeQuestion, findRunningTask, reserveBackgroundTask, runReservedTask } from "@/lib/background-tasks";
import { serializeWrite } from "@/lib/db-write-queue";
import { parseLastPractice, serializeLastPractice } from "@/lib/last-practice";
import type { LastPractice } from "@/lib/last-practice";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:practice:generate');

const DIFFICULTIES = ['easy', 'medium', 'hard', 'harder'] as const;

/**
 * GET /api/practice/generate?errorItemId=xxx
 * 读取该错题最近一次生成的举一反三题目，没有时返回 { practice: null }
 */
async function handleGet(req: Request, { user }: AuthenticatedContext) {
    try {
        const errorItemId = new URL(req.url).searchParams.get("errorItemId");
        if (!errorItemId) {
            return notFound("Item not found");
        }

        const item = await prisma.errorItem.findUnique({
            where: { id: errorItemId },
            select: { userId: true, lastPractice: true }
        });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }

        return NextResponse.json({ practice: parseLastPractice(item.lastPractice) });
    } catch (error) {
        logger.error({ error }, 'Error loading last practice');
        return internalError("Failed to load last practice question");
    }
}

export const GET = withUser(handleGet);

async function handlePostInner(req: Request, { user }: AuthenticatedContext) {
    try {
        const parsed = generatePracticeSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return badRequest("errorItemId is required");
        }
        const { errorItemId, language, difficulty } = parsed.data;

        const errorItemWithSubject = await prisma.errorItem.findUnique({
            where: { id: errorItemId },
            include: { subject: true }
        });

        // 只能基于自己的错题生成，否则等于间接读取他人题目
        if (!errorItemWithSubject || errorItemWithSubject.userId !== user.id) {
            return notFound("Item not found");
        }

        let tags: string[] = [];
        try {
            tags = JSON.parse(errorItemWithSubject.knowledgePoints || "[]");
        } catch {
            tags = [];
        }

        // 按目标防重复：同一错题同一时刻只允许一个「举一反三」任务（reserve 失败返回 409，不扣额度、不调用 AI）
        const target = `error-item:${errorItemId}:practice`;
        const handle = reserveBackgroundTask({
            userId: user.id,
            kind: 'practice',
            subject: describeQuestion(errorItemWithSubject),
            link: `/error-items/${errorItemId}`,
            target,
        });
        if (!handle) {
            return taskAlreadyRunning(findRunningTask(user.id, target) ?? { id: '', kind: 'practice', startedAt: '', target });
        }

        const limited = await serializeWrite(() => consumeAiQuota(user, 'practice'));
        if (limited) {
            handle.cancel();
            return limited;
        }

        const aiService = getAIService();
        const similarQuestion = await runReservedTask(handle, () =>
            aiService.generateSimilarQuestion(
                errorItemWithSubject.questionText || "",
                tags,
                language,
                difficulty || 'medium',
                errorItemWithSubject.gradeSemester,
                errorItemWithSubject.figureSvg
            )
        );

        // Inject the subject from the database with type safety
        const validSubjects = ["数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"] as const;
        const subjectName = errorItemWithSubject.subject?.name || "其他";
        similarQuestion.subject = (validSubjects as readonly string[]).includes(subjectName) ? subjectName as typeof validSubjects[number] : "其他";

        // 暂存本次生成结果，下次进入练习页直接显示；写入失败不影响本次返回
        const lastPractice: LastPractice = {
            questionText: similarQuestion.questionText,
            answerText: similarQuestion.answerText,
            analysis: similarQuestion.analysis,
            subject: similarQuestion.subject,
            figureSvg: similarQuestion.figureSvg ?? null,
            difficulty: DIFFICULTIES.find(d => d === difficulty) ?? 'medium',
            generatedAt: new Date().toISOString(),
        };
        try {
            await prisma.errorItem.update({
                where: { id: errorItemId },
                data: { lastPractice: serializeLastPractice(lastPractice) }
            });
        } catch (error) {
            logger.warn({ error }, 'Failed to cache last practice question');
        }

        return NextResponse.json({ ...similarQuestion, difficulty: lastPractice.difficulty, generatedAt: lastPractice.generatedAt });
    } catch (error) {
        logger.error({ error }, 'Error generating practice');
        const errorMessage = error instanceof Error ? error.message : "Failed to generate practice question";
        return internalError(errorMessage);
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(withUser(handlePostInner));

import { z } from "zod";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { validationError, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { serializeQuestions } from "@/lib/question-format";
import { fromErrorItem } from "@/lib/question-format/from-error-item";
import { getAppTimeZone } from "@/lib/config";
import { formatDateTime } from "@/lib/date-time";
import { getErrorMessage } from "@/lib/error-message";

const logger = createLogger("api:error-items/export-questions");

const exportQuestionsSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(2000),
    includeImages: z.boolean().optional(),
});

export const POST = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    try {
        const parsed = exportQuestionsSchema.safeParse(await req.json());
        if (!parsed.success) {
            return validationError("EXPORT_QUESTIONS_INVALID_INPUT", parsed.error.issues);
        }
        const { ids, includeImages } = parsed.data;

        // 只查询属于当前用户的错题，不存在的 id 静默忽略
        const items = await prisma.errorItem.findMany({
            where: { id: { in: ids }, userId: user.id },
            select: {
                id: true,
                questionText: true,
                answerText: true,
                analysis: true,
                wrongAnswerText: true,
                difficultyStars: true,
                questionType: true,
                gradeSemester: true,
                source: true,
                figureSvg: true,
                originalImageUrl: true,
                subject: { select: { name: true } },
                tags: { select: { name: true } },
            },
        });

        // 按 ids 传入顺序输出
        const orderMap = new Map(ids.map((id, index) => [id, index]));
        items.sort((a, b) => {
            const ia = orderMap.get(a.id);
            const ib = orderMap.get(b.id);
            return (ia ?? 0) - (ib ?? 0);
        });

        let skipped = 0;
        const questions: NonNullable<ReturnType<typeof fromErrorItem>>[] = [];
        for (const item of items) {
            const mapped = fromErrorItem({
                id: item.id,
                questionText: item.questionText,
                answerText: item.answerText,
                analysis: item.analysis,
                wrongAnswerText: item.wrongAnswerText,
                difficultyStars: item.difficultyStars,
                questionType: item.questionType,
                gradeSemester: item.gradeSemester,
                source: item.source,
                figureSvg: item.figureSvg,
                originalImageUrl: item.originalImageUrl,
                subjectName: item.subject?.name ?? null,
                tags: item.tags,
            }, includeImages);
            if (mapped === null) {
                skipped += 1;
            } else {
                questions.push(mapped);
            }
        }

        const file = serializeQuestions(questions, {
            exportedAt: new Date().toISOString(),
            generator: "wrong-notebook",
        });
        // 文件内容严格符合交换格式；题干为空而跳过的题数放在响应头中
        const jsonString = JSON.stringify(file, null, 2);

        const dateStr = formatDateTime(new Date(), "yyyy-MM-dd", getAppTimeZone());
        const filename = `wrong-notebook-questions-${dateStr.replace(/-/g, "")}.json`;

        logger.info({
            userId: user.id,
            requestedCount: ids.length,
            exportedCount: questions.length,
            skippedCount: skipped,
            includeImages: includeImages ?? false,
        }, "Export questions completed");

        return new Response(jsonString, {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "X-Export-Skipped": String(skipped),
            },
        });
    } catch (error) {
        logger.error({
            error,
            errorMessage: getErrorMessage(error),
        }, "Export questions failed");
        return internalError("Failed to export questions");
    }
});

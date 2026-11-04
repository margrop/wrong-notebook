import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, validationError, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { recordExamResults } from "@/lib/exam/exam";
import { PRACTICE_RESULTS, scheduleMasteryEvaluation } from "@/lib/mastery";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:exams:results');

const resultsSchema = z.object({
    takenAt: z.string().datetime({ offset: true }).optional(),
    results: z.array(z.object({
        questionId: z.string().min(1),
        result: z.enum(PRACTICE_RESULTS as ['correct', 'wrong', 'not_attempted']).nullable(),
    })).min(1).max(100),
});

/**
 * POST /api/exams/:id/results
 * 录入一次试卷结果（同一题可多次录入），写入原题的举一反三记录并触发掌握概率重新评估
 */
export const POST = withUser(async (
    req: Request,
    { user, params }: AuthenticatedContext & { params: Promise<{ id: string }> }
) => {
    const { id } = await params;

    try {
        const parsed = resultsSchema.safeParse(await req.json());
        if (!parsed.success) {
            return validationError("Invalid exam results", parsed.error.issues);
        }

        const takenAt = parsed.data.takenAt ? new Date(parsed.data.takenAt) : new Date();
        const affected = await recordExamResults(id, user.id, takenAt, parsed.data.results);
        scheduleMasteryEvaluation(affected);

        return NextResponse.json({ success: true, affectedCount: affected.length });
    } catch (error) {
        if (error instanceof Error && error.message === 'EXAM_NOT_FOUND') {
            return notFound("Exam paper not found");
        }
        logger.error({ error }, 'Error recording exam results');
        return internalError("Failed to record exam results");
    }
});

import { NextResponse } from "next/server";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { badRequest, conflict, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { parseBankFile } from "@/lib/question-bank/format";
import { importQuestionBank } from "@/lib/question-bank/import";
import { withRecoverableResponse } from "@/lib/recoverable-response";
import type { QuestionBankSummary } from "@/lib/question-bank/types";

const logger = createLogger('api:question-banks');

/** 题库包最大体积（含 5000 题） */
const MAX_BANK_BODY_BYTES = 25 * 1024 * 1024;

function toSummary(bank: {
    id: string; name: string; description: string | null; stage: string; subjectKey: string | null;
    gradeRange: string | null; source: string | null; sourceUrl: string | null; license: string | null;
    questionCount: number; createdAt: Date; updatedAt: Date;
}): QuestionBankSummary {
    return {
        id: bank.id,
        name: bank.name,
        description: bank.description,
        stage: bank.stage,
        subjectKey: bank.subjectKey,
        gradeRange: bank.gradeRange,
        source: bank.source,
        sourceUrl: bank.sourceUrl,
        license: bank.license,
        questionCount: bank.questionCount,
        createdAt: bank.createdAt.toISOString(),
        updatedAt: bank.updatedAt.toISOString(),
    };
}

/** GET /api/question-banks：当前用户的真题库列表 */
async function handleGet(_req: Request, { user }: AuthenticatedContext) {
    try {
        const banks = await prisma.questionBank.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true, name: true, description: true, stage: true, subjectKey: true, gradeRange: true,
                source: true, sourceUrl: true, license: true, questionCount: true, createdAt: true, updatedAt: true,
            },
        });
        return NextResponse.json({ banks: banks.map(toSummary) });
    } catch (error) {
        logger.error({ error }, 'Failed to list question banks');
        return internalError('Failed to list question banks');
    }
}

/** POST /api/question-banks：导入题库包，可选同时写入错题本 */
async function handlePost(req: Request, { user }: AuthenticatedContext) {
    try {
        const contentLength = req.headers.get('content-length');
        if (contentLength && Number.parseInt(contentLength, 10) > MAX_BANK_BODY_BYTES) {
            return badRequest('BANK_FILE_TOO_LARGE');
        }
        const raw: unknown = await req.json().catch(() => null);
        if (!raw || typeof raw !== 'object') return badRequest('BANK_INVALID_INPUT');
        const body = raw as Record<string, unknown>;
        const parsed = parseBankFile(body.file);
        if (!parsed.success) {
            return badRequest(`BANK_INVALID_FORMAT: ${parsed.error}`);
        }
        if (parsed.data.questions.length === 0) {
            return badRequest('BANK_EMPTY');
        }
        const notebookId = typeof body.notebookId === 'string' && body.notebookId.trim() ? body.notebookId.trim() : null;
        if (notebookId) {
            const notebook = await prisma.subject.findFirst({ where: { id: notebookId, userId: user.id }, select: { id: true } });
            if (!notebook) return badRequest('BANK_INVALID_NOTEBOOK');
        }
        const outcome = await importQuestionBank({
            user,
            file: parsed.data,
            name: typeof body.name === 'string' ? body.name : null,
            description: typeof body.description === 'string' ? body.description : null,
            addToErrorItems: body.addToErrorItems === true,
            notebookId,
        });
        if (!outcome.ok) {
            if (outcome.code === 'BANK_NAME_EXISTS') return conflict(`BANK_NAME_EXISTS: ${outcome.message}`);
            return badRequest(outcome.code);
        }
        return NextResponse.json(outcome.result, { status: 201 });
    } catch (error) {
        logger.error({ error }, 'Failed to import question bank');
        return internalError('Failed to import question bank', { error, scope: 'api:question-banks' });
    }
}

export const GET = withUser(handleGet);
export const POST = withRecoverableResponse(withUser(handlePost));

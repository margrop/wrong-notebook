import type { Prisma } from '@prisma/client';
import { DEFAULT_QUESTION_DUPLICATE_THRESHOLD, duplicateQuestionSimilarity } from '@/lib/question/question-similarity';
import { translations } from '@/lib/translations';
import { runSerializedTransaction } from "@/lib/db-write-queue";

export interface ImportedQuestionContent {
    questionText?: string | null;
    ocrText?: string | null;
    answerText?: string | null;
    analysis?: string | null;
    wrongAnswerText?: string | null;
    mistakeAnalysis?: string | null;
    originalImageUrl?: string | null;
}

interface DuplicateQuestion {
    id: string;
    similarity: number;
}

/** 分页比较当前用户的完整题库；不同错题本也参与判重，不受导入时间限制。 */
export async function findDuplicateQuestion(
    client: Prisma.TransactionClient,
    userId: string,
    content: ImportedQuestionContent,
): Promise<DuplicateQuestion | null> {
    const text = content.questionText?.trim() || content.ocrText?.trim();
    if (!text) return null;
    const user = await client.user.findUnique({ where: { id: userId }, select: { questionDuplicateThreshold: true } });
    const threshold = user?.questionDuplicateThreshold ?? DEFAULT_QUESTION_DUPLICATE_THRESHOLD;
    if (threshold >= 100) return null;

    const pageSize = 200;
    let cursor: string | undefined;
    let bestMatch: DuplicateQuestion | null = null;
    while (true) {
        const candidates = await client.errorItem.findMany({
            where: { userId },
            select: { id: true, questionText: true, ocrText: true },
            orderBy: { id: 'asc' },
            take: pageSize,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const candidate of candidates) {
            const candidateText = candidate.questionText?.trim() || candidate.ocrText?.trim();
            if (!candidateText) continue;
            const similarity = duplicateQuestionSimilarity(text, candidateText, threshold);
            if (similarity !== null && (!bestMatch || similarity > bestMatch.similarity)) {
                bestMatch = { id: candidate.id, similarity };
                if (similarity === 1) return bestMatch;
            }
        }
        if (candidates.length < pageSize) return bestMatch;
        cursor = candidates[candidates.length - 1].id;
    }
}

/** 与判重处于同一事务内，保存本次做错快照，原题内容和历史记录均保留。 */
export async function recordDuplicateQuestion(
    client: Prisma.TransactionClient,
    userId: string,
    duplicate: DuplicateQuestion,
    content: ImportedQuestionContent,
) {
    const existing = await client.errorItem.findFirstOrThrow({
        where: { id: duplicate.id, userId },
        include: { tags: true, subject: { select: { id: true, name: true } } },
    });
    const record = await client.practiceRecord.create({
        data: {
            userId,
            errorItemId: existing.id,
            subject: existing.subject?.name ?? null,
            result: 'wrong',
            isCorrect: false,
            source: 'duplicate_import',
            questionText: content.questionText?.trim() || content.ocrText?.trim() || existing.questionText,
            answerText: content.answerText || null,
            analysis: content.analysis || null,
            wrongAnswerText: content.wrongAnswerText || null,
            mistakeAnalysis: content.mistakeAnalysis || null,
            originalImageUrl: content.originalImageUrl || null,
        },
    });
    return {
        ...existing,
        duplicate: true as const,
        similarity: duplicate.similarity,
        mistakeRecorded: true as const,
        practiceRecordId: record.id,
        message: translations.zh.importFlow.duplicate,
    };
}

/** 判重与写入一起提交，并在进程内串行执行，避免同时导入的相同题目都判为新题或互相锁等待。 */
export function runQuestionImportTransaction<T>(operation: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    // 与识别任务、多题批次的其他写入共用同一个进程内写入队列
    return runSerializedTransaction(operation);
}

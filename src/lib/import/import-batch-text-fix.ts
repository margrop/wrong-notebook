/**
 * 分题预览中的「AI 修正文字」（服务端）：只返回修正建议，不改动草稿。
 * 建议由前端写入草稿、经用户逐题确认后才替换题目文字，开始解析前未确认的题仍按原文处理。
 *
 * - 只用于本人、待确认（draft）的文字批次；
 * - 题多时按 TEXT_FIX_CHUNK_SIZE 分几次调用模型，某一组失败只影响该组的题；
 * - 每条结果按原文做安全校验（不新增数字、长度不明显增加），不通过的视为失败，保留原文。
 */
import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { z } from "zod";
import { getAIService } from "@/lib/ai";
import type { TextFixInput, TextFixResult } from "@/lib/ai";
import { consumeAiQuota } from "@/lib/ai-quota";
import { createErrorResponse, ErrorCode, notFound, taskAlreadyRunning, validationError } from "@/lib/api-errors";
import { describeQuestion, findRunningTask, reserveBackgroundTask, runReservedTask } from "@/lib/background-tasks";
import { serializeWrite } from "@/lib/db-write-queue";
import { getErrorMessage } from "@/lib/error-message";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { MAX_DRAFT_TEXT_LENGTH } from "@/lib/question-split/draft";
import type { TextFixSuggestion } from "@/lib/question-split/draft-ops";
import { checkTextFix, MAX_TEXT_FIX_ITEMS, TEXT_FIX_CHUNK_SIZE } from "@/lib/question-split/text-fix";

const logger = createLogger('import-batch-text-fix');

export const textFixRequestSchema = z.object({
    items: z.array(z.object({
        key: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
        text: z.string().min(1).max(MAX_DRAFT_TEXT_LENGTH),
    })).min(1).max(MAX_TEXT_FIX_ITEMS),
});

export interface TextFixResponse {
    /** 有修改且通过校验的建议 */
    fixes: TextFixSuggestion[];
    /** 模型认为无需修改的题 */
    unchanged: string[];
    /** 调用失败、没有返回或没通过校验的题 */
    failed: string[];
}

function chunks<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
}

/** 为文字批次中的若干题生成修正建议 */
export async function fixImportBatchText(user: Pick<User, 'id' | 'role'>, id: string, raw: unknown): Promise<NextResponse> {
    const parsed = textFixRequestSchema.safeParse(raw);
    if (!parsed.success) return validationError('IMPORT_BATCH_INVALID_TEXT_FIX', parsed.error.issues);
    const batch = await prisma.importBatch.findFirst({ where: { id, userId: user.id }, select: { status: true, source: true } });
    if (!batch) return notFound('IMPORT_BATCH_NOT_FOUND');
    if (batch.source !== 'text' || batch.status !== 'draft') {
        return createErrorResponse('IMPORT_BATCH_NOT_EDITABLE', 409, ErrorCode.CONFLICT);
    }

    // 同一个 key 只处理一次
    const items = [...new Map(parsed.data.items.map((item) => [item.key, item])).values()];

    // 按目标防重复：同一批次同一时刻只允许一个「AI 修正文字」任务（reserve 失败返回 409，不扣额度、不调用 AI）
    const target = `import-batch:${id}:fix-text`;
    const handle = reserveBackgroundTask({
        userId: user.id,
        kind: 'fix_text',
        subject: describeQuestion({ questionText: items[0].text }),
        link: `/import-batches/${id}`,
        target,
    });
    if (!handle) {
        return taskAlreadyRunning(findRunningTask(user.id, target) ?? { id: '', kind: 'fix_text', startedAt: '', target });
    }

    const limited = await serializeWrite(() => consumeAiQuota(user, 'split'));
    if (limited) {
        handle.cancel();
        return limited;
    }

    const ai = getAIService();
    const groups = chunks(items, TEXT_FIX_CHUNK_SIZE);
    const settled = await runReservedTask(handle, () =>
        Promise.allSettled(groups.map((group) => {
            const input: TextFixInput = group.map((item) => ({ id: item.key, text: item.text }));
            return ai.fixQuestionText(input);
        })),
    );

    const response: TextFixResponse = { fixes: [], unchanged: [], failed: [] };
    let firstError: unknown = null;
    settled.forEach((outcome, index) => {
        const group = groups[index];
        if (outcome.status === 'rejected') {
            firstError ??= outcome.reason;
            response.failed.push(...group.map((item) => item.key));
            return;
        }
        const byId = new Map((outcome.value as TextFixResult).map((entry) => [entry.id, entry]));
        for (const item of group) {
            const fixed = byId.get(item.key);
            if (!fixed) {
                response.failed.push(item.key);
                continue;
            }
            if (fixed.text === item.text.trim() || fixed.text === item.text) {
                response.unchanged.push(item.key);
                continue;
            }
            const rejection = checkTextFix(item.text, fixed.text);
            if (rejection) {
                logger.info({ batchId: id, key: item.key, rejection }, 'Text fix rejected');
                response.failed.push(item.key);
                continue;
            }
            response.fixes.push({ key: item.key, original: item.text, text: fixed.text, uncertain: fixed.uncertain });
        }
    });

    // 全部调用都失败时按 AI 错误返回，前端据错误码提示原因
    if (firstError && response.fixes.length === 0 && response.unchanged.length === 0) {
        const message = getErrorMessage(firstError);
        logger.error({ batchId: id, error: message }, 'Text fix failed');
        return createErrorResponse(message.startsWith('AI_') ? message.split(':')[0] : 'IMPORT_BATCH_TEXT_FIX_FAILED', 500, ErrorCode.INTERNAL_ERROR);
    }
    logger.info({ batchId: id, fixes: response.fixes.length, unchanged: response.unchanged.length, failed: response.failed.length }, 'Text fix done');
    return NextResponse.json(response);
}

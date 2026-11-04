/**
 * 结构化题目批量建批次（浏览器端）：把题库文件解析出的题目列表按单批上限切分，
 * 依次调用 API 创建多个批次。每批独立 clientRequestId，失败可重试，不会重复创建。
 */

import {
    MAX_CLIENT_SPLIT_QUESTIONS,
    MAX_CLIENT_SPLIT_TEXT_LENGTH,
    MAX_SPLIT_QUESTIONS,
    splitQuestionText,
} from "@/lib/question-split/text";
import { createImportBatch } from "@/lib/import/import-batch-client";
import type { CreateImportBatchInput } from "@/lib/import/import-batch-client";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";

/** 一道结构化题目（字段与草稿条目一致，宽松接受 null 与空串） */
export interface StructuredQuestionItem {
    text: string;
    material?: string | null;
    section?: string | null;
    label?: string | null;
    answer?: string | null;
    analysis?: string | null;
    knowledgePoints?: string[] | null;
    difficultyStars?: number | null;
    wrongAnswer?: string | null;
    questionType?: string | null;
    /** 题目原图 data URL（Word 内嵌图片或 JSON images 合成后） */
    image?: string | null;
}

/** 单次导入的结构化题目总数上限（与 MAX_CLIENT_SPLIT_QUESTIONS 一致） */
export const MAX_STRUCTURED_ITEMS_TOTAL = MAX_CLIENT_SPLIT_QUESTIONS;

export interface StructuredBatchOptions {
    language: "zh" | "en";
    subjectId?: string | null;
    targetSubjectId?: string | null;
    paperLevel?: string | null;
    /** 来源说明（文件名与格式），会写入批次的 sourceText 便于辨认 */
    origin?: { fileName?: string; format?: string };
    /**
     * 幂等键前缀：每片的 clientRequestId 为 `${prefix}-${index}`。
     * 同一 prefix 重试时不会重复建批次；缺省每次调用随机生成一次
     */
    clientRequestIdPrefix?: string;
}

export interface StructuredBatchSuccess {
    batches: ImportBatchDetail[];
    /** 本次导入使用的幂等键前缀（重试失败分片时传入同一 prefix） */
    clientRequestIdPrefix: string;
    /** 失败的分片与错误信息（每片 60 题） */
    failures: Array<{ index: number; items: StructuredQuestionItem[]; error: unknown }>;
}

/** 生成随机幂等键前缀 */
function randomPrefix(): string {
    return `sb-${Math.random().toString(36).slice(2, 10)}`;
}

/** 把任意数量的结构化题目按 60 题一组切分 */
/**
 * 单个批次中题目原图的总长度上限。图片存于批次草稿 JSON，预览、编辑草稿时整份往返，
 * 限制单批总量可避免几十 MB 的草稿拖慢导入中心。单张图片已压缩到约 1MB 以内。
 */
export const MAX_BATCH_IMAGE_LENGTH = 8 * 1024 * 1024;

/** 按题数（默认 60）与图片总长度（MAX_BATCH_IMAGE_LENGTH）切分，任一达到上限即开始新的一批 */
export function chunkStructuredItems(
    items: StructuredQuestionItem[],
    size = MAX_SPLIT_QUESTIONS,
    maxImageLength = MAX_BATCH_IMAGE_LENGTH,
): StructuredQuestionItem[][] {
    const chunks: StructuredQuestionItem[][] = [];
    let current: StructuredQuestionItem[] = [];
    let imageLength = 0;
    for (const item of items) {
        const length = item.image?.length ?? 0;
        if (current.length > 0 && (current.length >= size || imageLength + length > maxImageLength)) {
            chunks.push(current);
            current = [];
            imageLength = 0;
        }
        current.push(item);
        imageLength += length;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

/** 校验并规范化一道结构化题目（把空串转为 null，截断超长字段） */
function normalizeItem(item: StructuredQuestionItem): Record<string, unknown> {
    const trimmed = (value: string | null | undefined) => (value?.trim() ? value.trim().slice(0, 20000) : undefined);
    return {
        text: item.text,
        material: trimmed(item.material),
        section: item.section?.trim() ? item.section.trim().slice(0, 500) : undefined,
        label: item.label?.trim() ? item.label.trim().slice(0, 20) : undefined,
        answer: trimmed(item.answer),
        analysis: trimmed(item.analysis),
        knowledgePoints: item.knowledgePoints?.length ? item.knowledgePoints.slice(0, 100) : undefined,
        difficultyStars: item.difficultyStars ?? undefined,
        wrongAnswer: trimmed(item.wrongAnswer),
        questionType: item.questionType?.trim() ? item.questionType.trim().slice(0, 100) : undefined,
        image: item.image ?? undefined,
    };
}

/**
 * 把结构化题目列表按单批上限切分并依次创建批次。
 * 每片使用 `${clientRequestIdPrefix}-${index}` 作为幂等键：同一次导入重试时不会重复建批次。
 * 失败的分片记入 failures，不中断后续分片；调用方可凭返回的 prefix 重试失败分片。
 */
export async function createStructuredImportBatches(
    items: StructuredQuestionItem[],
    options: StructuredBatchOptions,
): Promise<StructuredBatchSuccess> {
    if (items.length === 0) throw new Error("STRUCTURED_ITEMS_EMPTY");
    if (items.length > MAX_STRUCTURED_ITEMS_TOTAL) throw new Error("STRUCTURED_ITEMS_TOO_MANY");
    const prefix = options.clientRequestIdPrefix ?? randomPrefix();
    const chunks = chunkStructuredItems(items);
    const batches: ImportBatchDetail[] = [];
    const failures: Array<{ index: number; items: StructuredQuestionItem[]; error: unknown }> = [];
    for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        const body: CreateImportBatchInput = {
            source: "text",
            splitter: "local",
            items: chunk.map(normalizeItem),
            language: options.language,
            subjectId: options.subjectId ?? undefined,
            targetSubjectId: options.targetSubjectId ?? undefined,
            paperLevel: options.paperLevel ?? undefined,
        };
        if (index === 0 && options.origin) {
            (body as { origin?: { fileName?: string; format?: string } }).origin = options.origin;
        }
        try {
            const batch = await createImportBatch(body, `${prefix}-${index}`);
            batches.push(batch);
        } catch (error) {
            failures.push({ index, items: chunk, error });
        }
    }
    return { batches, clientRequestIdPrefix: prefix, failures };
}

/** 判断长文字是否需要自动分批（本地分题结果超过单批上限） */
export function needsAutoSplit(result: { candidateCount: number; overflow: number; tooLong: boolean }): boolean {
    return result.candidateCount > MAX_SPLIT_QUESTIONS || result.overflow > 0 || result.tooLong;
}

/**
 * 把长文字一次性分题并转成结构化题目列表（纯函数，供测试）。
 * 使用客户端上限（100 万字 / 2000 题）处理全文：答案区按题号回填、公共材料与大题标题都不跨片丢失。
 * 超出 2000 题或 100 万字时抛错（由调用方提示用户）。
 */
export function splitLongTextToStructuredItems(
    text: string,
    options: { forceNumbered?: boolean } = {},
): StructuredQuestionItem[] {
    if (text.length > MAX_CLIENT_SPLIT_TEXT_LENGTH) throw new Error("TEXT_TOO_LONG_FOR_AUTO_SPLIT");
    const result = splitQuestionText(text, {
        forceNumbered: options.forceNumbered,
        maxLength: MAX_CLIENT_SPLIT_TEXT_LENGTH,
        maxQuestions: MAX_CLIENT_SPLIT_QUESTIONS,
    });
    if (result.tooLong) throw new Error("TEXT_TOO_LONG_FOR_AUTO_SPLIT");
    if (result.overflow > 0) throw new Error("TOO_MANY_QUESTIONS_FOR_AUTO_SPLIT");
    return result.questions.map((question) => ({
        text: question.text,
        material: question.material ?? null,
        section: question.section ?? null,
        label: question.label ?? null,
        answer: question.answer ?? null,
        analysis: question.analysis ?? null,
        knowledgePoints: question.knowledgePoints ?? null,
        difficultyStars: question.difficultyStars ?? null,
        wrongAnswer: question.wrongAnswer ?? null,
        questionType: question.questionType ?? null,
    }));
}

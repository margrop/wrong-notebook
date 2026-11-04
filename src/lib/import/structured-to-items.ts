/**
 * StructuredQuestion → 批次 items 的映射。
 * 草稿支持的字段直接对应；草稿不支持的字段（subject、gradeSemester、source、
 * figureSvg、extensions）忽略，统计出现次数供导入摘要提示。
 * images 不再计入「未导入字段」，而是在导入时合成为题目原图（item.image）。
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import type { StructuredQuestion } from "@/lib/question-format/types";
import type { StructuredQuestionItem } from "@/lib/import/structured-batches";
import type { ImageRenderer, SourceImage } from "@/lib/import/question-images";
import { composeQuestionImage } from "@/lib/import/question-images";

/** 草稿暂不支持的字段：导入时忽略并在摘要中提示 */
const IGNORED_FIELDS = ["subject", "gradeSemester", "source", "figureSvg", "extensions"] as const;
export type IgnoredField = (typeof IGNORED_FIELDS)[number];

export const IGNORED_FIELD_LABELS: Record<IgnoredField, { zh: string; en: string }> = {
    subject: { zh: "学科", en: "subject" },
    gradeSemester: { zh: "年级学期", en: "gradeSemester" },
    source: { zh: "来源", en: "source" },
    figureSvg: { zh: "配图 SVG", en: "figureSvg" },
    extensions: { zh: "扩展字段", en: "extensions" },
};

function hasIgnoredValue(question: StructuredQuestion, field: IgnoredField): boolean {
    const value = question[field];
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return Object.keys(value).length > 0;
}

/**
 * 统计题目列表中被忽略字段的出现次数（仅统计有值的字段）。
 * 返回按 IGNORED_FIELDS 顺序排列的条目。
 */
export function countIgnoredFields(questions: StructuredQuestion[]): Array<{ field: IgnoredField; count: number }> {
    const counts = new Map<IgnoredField, number>();
    for (const field of IGNORED_FIELDS) {
        let count = 0;
        for (const question of questions) {
            if (hasIgnoredValue(question, field)) count += 1;
        }
        if (count > 0) counts.set(field, count);
    }
    return Array.from(counts.entries()).map(([field, count]) => ({ field, count }));
}

/** 把一道结构化题目映射为批次 item（不含图片；图片由调用方异步合成） */
export function structuredQuestionToItem(question: StructuredQuestion): StructuredQuestionItem {
    return {
        text: question.text,
        material: question.material ?? null,
        section: question.section ?? null,
        label: question.label ?? null,
        answer: question.answer ?? null,
        analysis: question.analysis ?? null,
        knowledgePoints: question.knowledgePoints?.length ? question.knowledgePoints : null,
        difficultyStars: question.difficultyStars ?? null,
        wrongAnswer: question.wrongAnswer ?? null,
        questionType: question.questionType ?? null,
    };
}

/** 批量映射（不含图片合成） */
export function structuredQuestionsToItems(questions: StructuredQuestion[]): StructuredQuestionItem[] {
    return questions.map(structuredQuestionToItem);
}

/** 图片合成进度回调 */
export type ImageProgressCallback = (done: number, total: number) => void;

/**
 * 把 data URL 转为 SourceImage（解码 + 尺寸）。
 * 在浏览器端使用；测试中可通过 decodeFn 注入假实现。
 */
export type DecodeFn = (dataUrl: string) => Promise<SourceImage>;

/**
 * 异步批量映射：把 StructuredQuestion 列表转为批次 items，并异步合成图片。
 * 有 images 的题会调用 composeQuestionImage 合成为 item.image；
 * 通过 onProgress 报告进度（done/total）。
 */
export async function structuredQuestionsToItemsAsync(
    questions: StructuredQuestion[],
    options: {
        renderer?: ImageRenderer;
        decodeFn?: DecodeFn;
        onProgress?: ImageProgressCallback;
    } = {},
): Promise<StructuredQuestionItem[]> {
    const { renderer, decodeFn, onProgress } = options;
    const total = questions.length;
    let done = 0;

    const items: StructuredQuestionItem[] = [];
    for (const question of questions) {
        const item = structuredQuestionToItem(question);
        if (question.images?.length && renderer && decodeFn) {
            try {
                const sources = await Promise.all(
                    question.images.map((img) => decodeFn(img.dataUrl)),
                );
                item.image = await composeQuestionImage(sources, renderer);
            } catch {
                // 图片合成失败不阻断该题导入，仅丢弃图片
                item.image = null;
            }
        }
        items.push(item);
        done += 1;
        onProgress?.(done, total);
    }
    return items;
}

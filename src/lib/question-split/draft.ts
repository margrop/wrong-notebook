/**
 * 多题批次的分题草稿：预览页编辑、服务端保存与开始解析共用的结构和校验（不依赖数据库，可在浏览器中引用）。
 */
import { z } from "zod";
import { normalizeQuestionType } from "@/lib/question/question-type";
import { MAX_SPLIT_QUESTIONS } from "@/lib/question-split/text";
import type { SplitTextQuestion } from "@/lib/question-split/text";

/** 每题文字（含公共材料）的上限，与保存错题的题干上限一致 */
export const MAX_DRAFT_TEXT_LENGTH = 20000;
/** 一题最多关联的原图区域数 */
export const MAX_ITEM_REGIONS = 4;
/** 区域最小边长（相对整图），过小的框不可能包含一道题 */
export const MIN_REGION_SIZE = 0.01;

/** 原图上的区域，相对坐标 0～1 */
export const draftRegionSchema = z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(MIN_REGION_SIZE).max(1),
    height: z.number().min(MIN_REGION_SIZE).max(1),
}).refine((region) => region.x + region.width <= 1.0001 && region.y + region.height <= 1.0001, { message: 'REGION_OUT_OF_BOUNDS' });
export type DraftRegion = z.infer<typeof draftRegionSchema>;

/** 需要用户留意的情况：模型标记看不清、只识别到部分、或没有给出可用区域 */
export const DRAFT_ITEM_FLAGS = ['unclear', 'partial', 'unlocated'] as const;
export type DraftItemFlag = typeof DRAFT_ITEM_FLAGS[number];

/** 一题最多关联的知识点个数；单个知识点名称的上限 */
export const MAX_ITEM_KNOWLEDGE_POINTS = 100;
export const MAX_KNOWLEDGE_POINT_LENGTH = 200;

/** 单张题目图片 data URL 的字符数上限（约 1.5MB）；超限由前端导入阶段丢弃并提示 */
export const MAX_DRAFT_IMAGE_LENGTH = 3 * 512 * 1024;

/** 题目原图 data URL 的校验（jpeg/png/webp）；失败时返回明确错误码而非笼统 400 */
export const draftImageSchema = z.string()
    .max(MAX_DRAFT_IMAGE_LENGTH, 'DRAFT_IMAGE_TOO_LARGE')
    .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, 'DRAFT_IMAGE_INVALID');

/** AI 修正文字的建议：基于 original 生成，用户接受前题目仍按原文解析 */
export const draftTextFixSchema = z.object({
    /** 生成建议时的题目原文；题目文字已改动时建议作废 */
    original: z.string().max(MAX_DRAFT_TEXT_LENGTH),
    /** 修正后的文字 */
    text: z.string().max(MAX_DRAFT_TEXT_LENGTH),
    /** 模型拿不准、保留原样的片段 */
    uncertain: z.array(z.string().max(200)).max(20),
});
export type DraftTextFix = z.infer<typeof draftTextFixSchema>;

export const draftItemSchema = z.object({
    key: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    label: z.string().max(20).nullable(),
    text: z.string().max(MAX_DRAFT_TEXT_LENGTH),
    material: z.string().max(MAX_DRAFT_TEXT_LENGTH).nullable(),
    section: z.string().max(500).nullable(),
    selected: z.boolean(),
    regions: z.array(draftRegionSchema).max(MAX_ITEM_REGIONS),
    hasFigure: z.boolean(),
    flags: z.array(z.enum(DRAFT_ITEM_FLAGS)).max(DRAFT_ITEM_FLAGS.length),
    /** 待确认的 AI 修正建议（只用于文字批次）；旧草稿没有此字段 */
    fix: draftTextFixSchema.nullish(),
    /** 参考答案（题库文件自带时按原样带入，不调用 AI）；旧草稿没有此字段 */
    answer: z.string().max(MAX_DRAFT_TEXT_LENGTH).nullish(),
    /** 参考解析；旧草稿没有此字段 */
    analysis: z.string().max(MAX_DRAFT_TEXT_LENGTH).nullish(),
    /** 知识点名称列表；旧草稿没有此字段 */
    knowledgePoints: z.array(z.string().max(MAX_KNOWLEDGE_POINT_LENGTH)).max(MAX_ITEM_KNOWLEDGE_POINTS).optional(),
    /** 难度星级（1～5）；旧草稿没有此字段 */
    difficultyStars: z.number().int().min(1).max(5).nullish(),
    /** 题型（question-type.ts 中的 key）；旧草稿没有此字段 */
    questionType: z.string().max(200).nullish(),
    /** 学生的错误作答；旧草稿没有此字段 */
    wrongAnswer: z.string().max(MAX_DRAFT_TEXT_LENGTH).nullish(),
    /** 题目原图；旧草稿没有此字段 */
    image: draftImageSchema.nullish(),
});
export type DraftItem = z.infer<typeof draftItemSchema>;

/** 整批的提示：图片模糊、只拍到部分、结果被截断、题数超过上限 */
export const DRAFT_WARNINGS = ['blurry', 'partial', 'truncated', 'tooMany'] as const;
export type DraftWarning = typeof DRAFT_WARNINGS[number];

export const batchDraftSchema = z.object({
    items: z.array(draftItemSchema).max(MAX_SPLIT_QUESTIONS),
    ignored: z.array(z.string().max(MAX_DRAFT_TEXT_LENGTH)).max(200),
    warnings: z.array(z.enum(DRAFT_WARNINGS)).max(DRAFT_WARNINGS.length),
}).superRefine((draft, context) => {
    const keys = new Set<string>();
    for (const item of draft.items) {
        if (keys.has(item.key)) context.addIssue({ code: 'custom', message: 'DUPLICATE_ITEM_KEY' });
        keys.add(item.key);
    }
});
export type BatchDraft = z.infer<typeof batchDraftSchema>;

/** 新题目的标识：同一草稿内唯一即可 */
export function newItemKey(existing: Iterable<string> = []): string {
    const used = new Set(existing);
    for (;;) {
        const key = `q${Math.random().toString(36).slice(2, 10)}`;
        if (!used.has(key)) return key;
    }
}

/** 本地文字分题结果转为草稿；overflow 为超出上限、已列入 ignored 的题数 */
export function draftFromTextSplit(questions: SplitTextQuestion[], ignored: string[], overflow = 0): BatchDraft {
    const keys: string[] = [];
    const items = questions.slice(0, MAX_SPLIT_QUESTIONS).map((question) => {
        const key = newItemKey(keys);
        keys.push(key);
        return {
            key,
            label: question.label?.slice(0, 20) ?? null,
            text: question.text.slice(0, MAX_DRAFT_TEXT_LENGTH),
            material: question.material?.slice(0, MAX_DRAFT_TEXT_LENGTH) ?? null,
            section: question.section?.slice(0, 500) ?? null,
            selected: question.text.trim().length > 0,
            regions: [],
            hasFigure: false,
            flags: [],
            answer: question.answer ?? null,
            analysis: question.analysis ?? null,
            knowledgePoints: question.knowledgePoints?.slice(0, MAX_ITEM_KNOWLEDGE_POINTS),
            difficultyStars: question.difficultyStars ?? null,
            questionType: normalizeQuestionType(question.questionType),
            wrongAnswer: question.wrongAnswer ?? null,
        };
    });
    return { items, ignored: ignored.slice(0, 200), warnings: overflow > 0 || questions.length > MAX_SPLIT_QUESTIONS ? ['tooMany'] : [] };
}

/** 可以开始解析的题：文字批次需有题干，图片批次需有区域 */
export function isItemReady(item: DraftItem, source: 'text' | 'image'): boolean {
    return source === 'image' ? item.regions.length > 0 : item.text.trim().length > 0;
}

/** 已选且可以开始解析的题 */
export function readyItems(draft: BatchDraft, source: 'text' | 'image'): DraftItem[] {
    return draft.items.filter((item) => item.selected && isItemReady(item, source));
}

/** 多个区域的外接矩形（用于在原图上标出一题的位置） */
export function boundingRegion(regions: DraftRegion[]): DraftRegion | null {
    if (regions.length === 0) return null;
    const x = Math.min(...regions.map((region) => region.x));
    const y = Math.min(...regions.map((region) => region.y));
    const right = Math.max(...regions.map((region) => region.x + region.width));
    const bottom = Math.max(...regions.map((region) => region.y + region.height));
    return { x, y, width: right - x, height: bottom - y };
}

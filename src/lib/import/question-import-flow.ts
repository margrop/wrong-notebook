import type { CompletedStage } from "@/components/ui/progress-feedback";
import type { ParsedQuestion } from "@/lib/ai";
import type { CreateImportBatchInput } from "@/lib/import/import-batch-client";
import type { CreateImportTaskInput } from "@/lib/import/import-task-client";
import type { ImportImageInfo } from "@/lib/import/import-task-types";
import { describeImage, renderRegion } from "@/lib/image-pipeline";
import type { PreparedImage, RenderedImage } from "@/lib/image-pipeline";
import type { ImageRegion } from "@/lib/image-crop";
import { normalizeMistakeStatus } from "@/lib/question/mistake-status";
import type { Translations } from "@/lib/translations";

export type ReviewedQuestion = ParsedQuestion & { subjectId?: string; paperLevel?: string };

/** 框选批量导入的一道题：已从原图裁剪并压缩好的图片 */
export interface BatchImage {
    dataUrl: string;
    info: ImportImageInfo;
    timings: { read: number; convert: number; crop: number; compress: number };
}

/** 一道题最多分几段（几张纸）拍摄 */
export const MAX_QUESTION_PARTS = 4;

export interface ReanswerResponse {
    gradeSemester?: string | null;
    answerText: string;
    analysis: string;
    knowledgePoints: string[];
    wrongAnswerText: string;
    mistakeAnalysis: string;
    mistakeStatus: string;
    difficultyStars?: number | null;
    subject?: string;
}

/** 免确认/校对时目标错题本的计算上下文 */
export interface TargetSubjectContext {
    /** 校对后保存时固定放入的错题本 */
    fixedSubjectId?: string;
    /** 是否已开启人工确认 */
    confirmBeforeImport: boolean;
    /** 免确认直接入库时放入的错题本 */
    importSubjectId?: string | null;
}

/**
 * 多题批次与单题上传放入的错题本：
 * 固定错题本优先；免确认时放入指定错题本，校对时由用户在校对页选择（null）。
 */
export function resolveTargetSubjectId(ctx: TargetSubjectContext): string | null {
    return ctx.fixedSubjectId ?? (ctx.confirmBeforeImport ? null : ctx.importSubjectId ?? null);
}

/** 已完成的处理阶段列表（读取、格式转换、裁剪压缩） */
export function buildStageList(timings: Partial<BatchImage["timings"]>, t: Translations): CompletedStage[] {
    return [
        { label: t.upload.stages.read, ms: timings.read ?? 0 },
        ...(timings.convert !== undefined ? [{ label: t.upload.stages.convert, ms: timings.convert }] : []),
        ...(timings.compress !== undefined ? [{ label: t.upload.stages.compress, ms: (timings.crop ?? 0) + timings.compress }] : []),
    ];
}

/** 从原图逐框裁剪并压缩，返回各区域的图片与耗时 */
export async function renderRegions(prepared: PreparedImage, regions: ImageRegion[]): Promise<BatchImage[]> {
    const images: BatchImage[] = [];
    for (const region of regions) {
        const rendered: RenderedImage = await renderRegion(prepared, region);
        images.push({ dataUrl: rendered.dataUrl, info: describeImage(prepared, rendered), timings: { ...prepared.timings, ...rendered.timings } });
    }
    return images;
}

/** 拼接结果：stackQuestionImages 的输出加上各段累计的耗时与字节数 */
export interface StackedResult {
    dataUrl: string;
    info: ImportImageInfo;
    timings: BatchImage["timings"];
}

/** 把各段纵向拼成一张图后的结果转为可上传的 BatchImage（耗时、字节数按各段累计） */
export function toStackedBatchImage(list: BatchImage[], rendered: RenderedImage): StackedResult {
    const sum = (key: keyof BatchImage["timings"]) => list.reduce((total, part) => total + part.timings[key], 0);
    return {
        dataUrl: rendered.dataUrl,
        info: {
            sourceType: `stacked-${list.length}`,
            sourceBytes: list.reduce((total, part) => total + (part.info.sourceBytes ?? 0), 0),
            outputWidth: rendered.width, outputHeight: rendered.height, outputBytes: rendered.bytes, quality: rendered.quality,
        },
        timings: { read: sum('read'), convert: sum('convert'), crop: sum('crop') + rendered.timings.crop, compress: sum('compress') + rendered.timings.compress },
    };
}

/** 上传识别任务的请求参数（添加页固定错题本，免确认时放入指定错题本，校对时由用户选择） */
export function buildCreateTaskParams(
    image: BatchImage,
    ctx: TargetSubjectContext & { language: "zh" | "en"; analyzeSubjectId?: string | null },
): CreateImportTaskInput {
    return {
        imageBase64: image.dataUrl,
        language: ctx.language,
        subjectId: ctx.analyzeSubjectId,
        targetSubjectId: resolveTargetSubjectId(ctx),
        clientTimings: image.timings,
        imageInfo: image.info,
    };
}

export interface TextBatchParams {
    text: string;
    splitter: "local" | "ai";
    forceNumbered?: boolean;
    language: "zh" | "en";
    analyzeSubjectId?: string | null;
    textNotebookId?: string;
}

/** 多题文字批次的请求参数（本地规则分题不调用 AI；splitter 为 ai 时由模型分题） */
export function buildTextBatchParams(params: TextBatchParams, ctx: TargetSubjectContext): CreateImportBatchInput {
    return {
        source: "text",
        splitter: params.splitter,
        forceNumbered: params.forceNumbered || undefined,
        text: params.text,
        language: params.language,
        subjectId: params.analyzeSubjectId ?? params.textNotebookId,
        targetSubjectId: resolveTargetSubjectId(ctx),
    };
}

/** 照片自动分题批次的请求参数 */
export function buildImageBatchParams(
    image: BatchImage,
    ctx: TargetSubjectContext & { language: "zh" | "en"; analyzeSubjectId?: string | null },
): CreateImportBatchInput {
    return {
        source: "image",
        imageBase64: image.dataUrl,
        imageInfo: image.info,
        language: ctx.language,
        subjectId: ctx.analyzeSubjectId,
        targetSubjectId: resolveTargetSubjectId(ctx),
    };
}

export interface TextReanswerParams {
    questionText: string;
    language: "zh" | "en";
    textNotebook?: { id: string; name: string };
}

/** 文字解题的 /api/reanswer 请求体 */
export function buildTextReanswerBody({ questionText, language, textNotebook }: TextReanswerParams) {
    return {
        questionText,
        language,
        forImport: true,
        subject: textNotebook?.name,
        subjectId: textNotebook?.id,
    };
}

/** 文字解题响应 → ParsedQuestion（规范化作答状态与学科，缺失字段补默认值） */
export function parseReanswerResponse(result: ReanswerResponse, questionText: string): ParsedQuestion {
    return {
        questionText,
        answerText: result.answerText,
        analysis: result.analysis,
        knowledgePoints: result.knowledgePoints || [],
        wrongAnswerText: result.wrongAnswerText || "",
        mistakeAnalysis: result.mistakeAnalysis || "",
        mistakeStatus: normalizeMistakeStatus(result.mistakeStatus),
        subject: (result.subject || "其他") as ParsedQuestion["subject"],
        requiresImage: false,
        difficultyStars: result.difficultyStars ?? null,
        gradeSemester: result.gradeSemester ?? null,
    };
}

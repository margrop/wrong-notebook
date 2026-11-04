import { z } from "zod";
import { MIN_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/constants/pagination";
import { isValidFigureAlign, isValidFigureScale } from "@/lib/figure-scale";

/** PUT /api/error-items/:id 请求体（所有字段可选，前端按需发送） */
export const updateErrorItemSchema = z.object({
    knowledgePoints: z.union([z.array(z.string()), z.string()]).nullable().optional(),
    gradeSemester: z.string().nullable().optional(),
    paperLevel: z.string().nullable().optional(),
    questionText: z.string().optional(),
    answerText: z.string().optional(),
    analysis: z.string().optional(),
    subjectId: z.string().optional(),
    wrongAnswerText: z.string().nullable().optional(),
    mistakeAnalysis: z.string().nullable().optional(),
    mistakeStatus: z.string().nullable().optional(),
    geogebraCommands: z.string().nullable().optional(),
    difficultyStars: z.number().int().min(1).max(5).nullable().optional(),
    questionType: z.string().max(200).nullable().optional(),
    figureScale: z.number().optional().refine(
        (value) => value === undefined || isValidFigureScale(value),
        { message: "figureScale must be an integer from 10 to 200" },
    ),
    figureAlign: z.string().optional().refine(
        (value) => value === undefined || isValidFigureAlign(value),
        { message: "figureAlign must be left, center, or right" },
    ),
});

/** PATCH /api/error-items/:id/notes 请求体 */
export const updateNotesSchema = z.object({
    userNotes: z.string().nullable(),
});

/** POST /api/error-items/batch-delete 请求体 */
export const batchDeleteSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(100),
});

/** POST /api/error-items/:id/geogebra 请求体（所有字段可选，后端从 DB fallback） */
export const geogebraAnalyzeSchema = z.object({
    questionText: z.string().optional(),
    answerText: z.string().optional(),
    previousErrors: z.string().optional(),
});

/** POST /api/error-items/:id/reanswer 请求体 */
export const reanswerSchema = z.object({
    language: z.enum(["zh", "en"]).optional(),
});

/** POST /api/error-items/:id/retag 请求体 */
export const retagSchema = z.object({
    preview: z.boolean().optional(),
});

/** POST /api/error-items/:id/svg-animation 请求体 */
export const svgAnimationSchema = z.object({
    language: z.enum(["zh", "en"]).optional(),
});

/** 分页查询参数中的 page/pageSize（用于校验查询字符串） */
export const paginationQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(MIN_PAGE_SIZE).max(MAX_PAGE_SIZE).default(18),
});

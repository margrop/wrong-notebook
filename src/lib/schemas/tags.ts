import { z } from "zod";

/** POST /api/tags 请求体 */
export const createTagSchema = z.object({
    name: z.string().trim().min(1),
    subject: z.string().trim().min(1),
    parentId: z.string().nullish(),
    /** 缺省或空白时由路由回退为 default */
    tagSet: z.string().optional(),
});

/** DELETE /api/tags 查询参数 */
export const deleteTagQuerySchema = z.object({
    id: z.string().trim().min(1),
});

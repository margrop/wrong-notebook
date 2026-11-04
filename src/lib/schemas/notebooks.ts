import { z } from "zod";
import { isValidNotebookScope, type NotebookStage, type NotebookSubject } from "@/lib/notebook-scope";

/** POST /api/notebooks 请求体 */
export const createNotebookSchema = z.object({
    name: z.string().trim().min(1),
    stage: z.string(),
    subjectKey: z.string(),
    /** 缺省或空白时由路由回退为 default */
    tagSet: z.string().optional(),
}).refine(
    (data) => isValidNotebookScope(data.stage as NotebookStage, data.subjectKey as NotebookSubject),
    { message: "A valid stage and subject are required" }
);

/** PUT /api/notebooks/[id] 请求体 */
export const updateNotebookSchema = z.object({
    name: z.string().trim().min(1),
});

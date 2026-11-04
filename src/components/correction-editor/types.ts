import type { ParsedQuestion } from "@/lib/ai";

/** 校对页编辑中的题目：AI 识别结果加上归属错题本、年级学期、卷别和 GeoGebra 命令 */
export interface CorrectionDraft extends ParsedQuestion {
    subjectId?: string;
    gradeSemester?: string | null;
    paperLevel?: string;
    geogebraCommands?: string;
    questionType?: string | null;
}

export type UpdateDraft = (fields: Partial<CorrectionDraft>) => void;

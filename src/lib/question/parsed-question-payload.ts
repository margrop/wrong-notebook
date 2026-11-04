import type { ParsedQuestion } from "@/lib/ai";

export interface ParsedQuestionSaveOptions {
    /** 指定错题本；为空时由服务端按识别学科匹配或新建错题本 */
    subjectId?: string | null;
    imageUrl?: string | null;
    paperLevel?: string | null;
}

/** 识别结果转为「添加错题」接口的请求内容；前端直接保存与服务端识别任务入库共用 */
export function parsedQuestionToSavePayload(parsed: ParsedQuestion, options: ParsedQuestionSaveOptions) {
    return {
        questionText: parsed.questionText,
        answerText: parsed.answerText,
        analysis: parsed.analysis,
        wrongAnswerText: parsed.wrongAnswerText || null,
        mistakeAnalysis: parsed.mistakeAnalysis || null,
        mistakeStatus: parsed.mistakeStatus || "unknown",
        knowledgePoints: parsed.knowledgePoints || [],
        difficultyStars: parsed.difficultyStars ?? null,
        recognizedGradeSemester: parsed.gradeSemester ?? null,
        hasFigure: parsed.hasFigure ?? false,
        figureSvg: parsed.figureSvg ?? null,
        subjectId: options.subjectId || undefined,
        subjectName: options.subjectId ? undefined : parsed.subject,
        originalImageUrl: options.imageUrl || "",
        paperLevel: options.paperLevel || undefined,
    };
}

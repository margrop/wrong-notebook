import { apiClient } from "@/lib/api-client";
import { processImageFile } from "@/lib/image-utils";
import type { ParsedQuestion } from "@/lib/ai";
import type { AnalyzeResponse, UserProfile } from "@/types/api";

/** 导入成功后的题目摘要 */
export interface ImportedQuestion {
    id: string;
    shortId: string | null;
    subjectId: string | null;
    notebookName: string | null;
    duplicate?: boolean;
}

interface CreatedErrorItem {
    id: string;
    shortId?: string | null;
    subjectId?: string | null;
    subject?: { id: string; name: string } | null;
    duplicate?: boolean;
}

/** 读取用户的「导入前人工确认」偏好，读取失败时按默认值（不确认）处理 */
export async function fetchConfirmBeforeImport(): Promise<boolean> {
    try {
        const user = await apiClient.get<UserProfile>("/api/user");
        return !!user.confirmBeforeImport;
    } catch {
        return false;
    }
}

/** 调用 AI 识别一张图片中的题目 */
export async function analyzeQuestionImage(
    imageBase64: string,
    options: { language: 'zh' | 'en'; subjectId?: string | null; timeout?: number }
): Promise<AnalyzeResponse> {
    const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
        imageBase64,
        language: options.language,
        subjectId: options.subjectId || undefined,
    }, { timeout: options.timeout, recoverable: true });
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid API response: data is null or not an object');
    }
    return data;
}

/**
 * 将识别结果直接保存为错题；未指定错题本时由服务端按学科匹配或新建错题本
 */
export async function saveParsedQuestion(
    parsed: ParsedQuestion,
    options: { subjectId?: string | null; imageUrl?: string | null }
): Promise<ImportedQuestion> {
    const created = await apiClient.post<CreatedErrorItem>("/api/error-items", {
        questionText: parsed.questionText,
        answerText: parsed.answerText,
        analysis: parsed.analysis,
        wrongAnswerText: parsed.wrongAnswerText || null,
        mistakeAnalysis: parsed.mistakeAnalysis || null,
        mistakeStatus: parsed.mistakeStatus || "unknown",
        knowledgePoints: parsed.knowledgePoints || [],
        difficultyStars: parsed.difficultyStars ?? null,
        hasFigure: parsed.hasFigure ?? false,
        figureSvg: parsed.figureSvg ?? null,
        subjectId: options.subjectId || undefined,
        subjectName: options.subjectId ? undefined : parsed.subject,
        originalImageUrl: options.imageUrl || "",
    });
    return {
        id: created.id,
        shortId: created.shortId ?? null,
        subjectId: created.subjectId ?? null,
        notebookName: created.subject?.name ?? null,
        duplicate: created.duplicate,
    };
}

/** 压缩、识别并保存一张题目图片（批量导入时每个框调用一次） */
export async function importQuestionImage(
    file: Blob,
    options: { language: 'zh' | 'en'; subjectId?: string | null; timeout?: number; onStage?: (stage: 'analyzing' | 'saving') => void }
): Promise<ImportedQuestion> {
    const imageBase64 = await processImageFile(file instanceof File ? file : new File([file], "question.jpg", { type: file.type || "image/jpeg" }));
    options.onStage?.('analyzing');
    const parsed = await analyzeQuestionImage(imageBase64, options);
    options.onStage?.('saving');
    return saveParsedQuestion(parsed, { subjectId: options.subjectId, imageUrl: imageBase64 });
}

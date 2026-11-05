/**
 * 识别一张题目图片：按用户年级规则与错题本的候选知识点调用 AI，并按年级规则确定最终年级。
 * /api/analyze 与识别导入任务共用。
 */
import { AI_REJECTION_CODES } from "@/lib/ai-limit-message";
import { getAIService } from "@/lib/ai";
import type { ParsedQuestion } from "@/lib/ai";
import { normalizeSubject, ParsedQuestionSchema } from "@/lib/ai/schema";
import type { CandidateTags, GradeLevel, QuestionSplitInput, QuestionSplitResult } from "@/lib/ai/types";
import { getNotebookCandidateTags } from "@/lib/ai/tag-service";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { getAppTimeZone } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { resolveNotebookScope, SUBJECT_DISPLAY_NAMES } from "@/lib/notebook-scope";
import { prisma } from "@/lib/prisma";
import { normalizeMistakeStatus } from "@/lib/question/mistake-status";
import { getFixedQuestionGrade, getQuestionGradeContext, resolveQuestionGrade } from "@/lib/question/question-grade";
import { trackAnalyze } from "@/lib/telemetry/events";
import type { QuestionGradeProfile } from "@/lib/question/question-grade";

const logger = createLogger('question-analysis');

export interface QuestionAnalysisInput {
    /** 会话中的用户邮箱，用于读取年级规则 */
    email: string | null | undefined;
    /** 后台任务登记表中的用户 ID */
    userId: string;
    imageBase64: string;
    mimeType?: string;
    language: 'zh' | 'en';
    subjectId?: string | null;
    /** 后台任务弹框中「查看」跳转的页面 */
    link?: string | null;
    /**
     * 参考文字：从题目原文件提取的文字层（如 PDF/Word 导入），可能因公式、排版而乱码或缺字。
     * 提供时随图片一起发给模型，仅供对照识别，模型仍以图片为准。
     */
    referenceText?: string | null;
}

/** 拆分 data URL；不是 data URL 时原样返回 */
export function parseImageDataUrl(imageBase64: string, mimeType?: string): { base64: string; mimeType?: string } {
    if (imageBase64.startsWith('data:')) {
        const matches = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) return { mimeType: matches[1], base64: matches[2] };
    }
    return { base64: imageBase64, mimeType };
}

/** 调用 AI 识别题目图片；AI 错误原样抛出，由调用方映射错误码 */
export async function analyzeQuestionForUser(input: QuestionAnalysisInput): Promise<ParsedQuestion> {
    const { base64, mimeType } = parseImageDataUrl(input.imageBase64, input.mimeType);

    // 先获取用户年级信息，用于动态生成 AI prompt 中的标签列表
    let userGrade: GradeLevel | null = null;
    let userGradeSemester: string | null = null;
    let subjectChinese: string | null = null;
    let candidateTags: CandidateTags | undefined;
    let notebookName: string | null = null;
    let gradeProfile: QuestionGradeProfile | null = null;

    if (input.email) {
        try {
            const user = await prisma.user.findUnique({
                where: { email: input.email },
                select: { id: true, educationStage: true, enrollmentYear: true, gradeRecognitionMode: true, fixedGradeSemester: true }
            });

            if (user) {
                gradeProfile = user;
                const context = getQuestionGradeContext(user, getAppTimeZone());
                userGrade = context.grade;
                userGradeSemester = context.gradeSemester;
                logger.debug({ userGrade, userGradeSemester }, 'Calculated user grade');
            }

            // 错题本的学段 + 学科决定候选知识点：直接取该范围内的全部标签
            if (input.subjectId && user) {
                const notebook = await prisma.subject.findUnique({
                    where: { id: input.subjectId },
                    select: { name: true, userId: true, stage: true, subjectKey: true, tagSet: true }
                });

                if (notebook && notebook.userId === user.id) {
                    notebookName = notebook.name;
                    const scope = resolveNotebookScope(notebook);
                    subjectChinese = scope.subject ? SUBJECT_DISPLAY_NAMES[scope.subject] : null;
                    candidateTags = await getNotebookCandidateTags(scope, notebook.tagSet || 'default');
                    logger.debug({ scope, tagSet: notebook.tagSet, candidateTagCount: candidateTags?.tags.length }, 'Notebook scope resolved');
                }
            }
        } catch (error) {
            logger.error({ error }, 'Error fetching user/subject info');
            // 继续执行，不传递年级参数（会返回所有年级的标签）
        }
    }

    logger.info({ userGrade, userGradeSemester, subject: subjectChinese, hasReferenceText: !!input.referenceText?.trim() }, 'Calling AI service for image analysis');
    const aiService = await getAIService({ userId: input.userId, kind: 'analyze' });
    const analysisResult = await trackBackgroundTask(
        { userId: input.userId, kind: 'analyze', subject: notebookName, link: input.link ?? null },
        () => trackAnalyze(() => aiService.analyzeImage(base64, mimeType, input.language, userGrade, subjectChinese, userGradeSemester, candidateTags, input.referenceText ?? null))
    );

    logger.debug({
        knowledgePointsCount: analysisResult.knowledgePoints?.length,
        knowledgePointsType: typeof analysisResult.knowledgePoints,
        isArray: Array.isArray(analysisResult.knowledgePoints)
    }, 'AI returned knowledge points');

    // AI 现在从数据库获取标签列表，返回的标签已经是标准化的，不需要额外处理
    if (!analysisResult.knowledgePoints || analysisResult.knowledgePoints.length === 0) {
        logger.warn('Knowledge points is empty or null');
    }

    return gradeProfile ? {
        ...analysisResult,
        gradeSemester: resolveQuestionGrade(gradeProfile, { recognizedGradeSemester: analysisResult.gradeSemester }, getAppTimeZone()),
    } : analysisResult;
}

const PASSTHROUGH_AI_ERRORS = new Set([
    'AI_CONNECTION_FAILED', 'AI_RESPONSE_ERROR', 'AI_TIMEOUT_ERROR', 'AI_QUOTA_EXCEEDED', 'AI_PERMISSION_DENIED',
    'AI_NOT_FOUND', 'AI_SERVICE_UNAVAILABLE', 'AI_UNKNOWN_ERROR', 'AI_OUTPUT_TRUNCATED', 'AI_IMAGE_NOT_SUPPORTED',
    ...AI_REJECTION_CODES,
]);

/** 把识别异常映射为前端可翻译的错误码 */
export function mapAnalysisError(message: string): string {
    if (message.includes('AI_AUTH_ERROR')) return 'AI_AUTH_ERROR';
    if (message.startsWith('AI_RESPONSE_ERROR')) return 'AI_RESPONSE_ERROR';
    if (PASSTHROUGH_AI_ERRORS.has(message)) return message;
    if (message.includes('Zod') || message.includes('validate')) return 'AI_RESPONSE_ERROR';
    return message || 'Failed to analyze image';
}

export interface QuestionTextAnalysisInput {
    userId: string;
    /** 题目原文（含公共材料），作为错题的题干保存 */
    questionText: string;
    language: 'zh' | 'en';
    subjectId?: string | null;
    link?: string | null;
}

/**
 * 解析一道文字题（多题批次中的文字任务）：与「文字 AI 解题」相同，按错题本的候选知识点和账户年级规则调用 AI，
 * 题干使用用户确认的原文，不由 AI 改写。
 */
export async function analyzeQuestionTextForUser(input: QuestionTextAnalysisInput): Promise<ParsedQuestion> {
    const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, educationStage: true, enrollmentYear: true, gradeRecognitionMode: true, fixedGradeSemester: true },
    });
    let candidateTags: CandidateTags | undefined;
    let notebookName: string | null = null;
    if (input.subjectId) {
        const notebook = await prisma.subject.findFirst({
            where: { id: input.subjectId, userId: input.userId },
            select: { name: true, stage: true, subjectKey: true, tagSet: true },
        });
        if (notebook) {
            notebookName = notebook.name;
            candidateTags = await getNotebookCandidateTags(resolveNotebookScope(notebook), notebook.tagSet || 'default');
        }
    }
    const fixedGrade = user ? getFixedQuestionGrade(user, getAppTimeZone()) : null;
    const result = await trackBackgroundTask(
        { userId: input.userId, kind: 'reanswer', subject: notebookName ?? describeQuestion({ questionText: input.questionText }), link: input.link ?? null },
        async () => (await getAIService({ userId: input.userId, kind: 'reanswer' })).reanswerQuestion(input.questionText, input.language, notebookName, undefined, fixedGrade ?? undefined, candidateTags),
    );
    const parsed: ParsedQuestion = {
        questionText: input.questionText,
        answerText: result.answerText,
        analysis: result.analysis,
        knowledgePoints: (result.knowledgePoints || []).slice(0, 5),
        wrongAnswerText: result.wrongAnswerText || '',
        mistakeAnalysis: result.mistakeAnalysis || '',
        mistakeStatus: normalizeMistakeStatus(result.mistakeStatus),
        subject: normalizeSubject(result.subject) || '其他',
        requiresImage: false,
        difficultyStars: result.difficultyStars ?? null,
        questionType: result.questionType ?? null,
        gradeSemester: user ? resolveQuestionGrade(user, { recognizedGradeSemester: result.gradeSemester }, getAppTimeZone()) : result.gradeSemester ?? null,
    };
    const validation = ParsedQuestionSchema.safeParse(parsed);
    if (!validation.success) throw new Error('AI_RESPONSE_ERROR');
    return validation.data;
}

/** 调用 AI 分题（文字按行号，图片附带图片内容），记入后台任务 */
export async function splitQuestionsForUser(userId: string, input: QuestionSplitInput, link?: string | null): Promise<QuestionSplitResult> {
    return trackBackgroundTask(
        { userId, kind: 'split', subject: null, link: link ?? null },
        async () => (await getAIService({ userId, kind: 'split' })).splitQuestions(input),
    );
}

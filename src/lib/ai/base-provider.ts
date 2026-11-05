import "server-only";

import type { AIService, GradeLevel, ParsedQuestion, DifficultyLevel, ReanswerQuestionResult, GeogebraAnalysisResult, MasteryEvaluationInput, MasteryEvaluationResult, AnswerGradingInput, AnswerGradingResult, TagSuggestionInput, TagSuggestionResult, CandidateTags, FigureResult } from "./types";
import type { LatexFixInput, LatexFixResult } from './latex-fix';
import type { QuestionSplitInput, QuestionSplitResult } from './question-split';
import type { TextFixInput, TextFixResult } from './text-fix';
import { generateGradeRecognitionRequest, generateAnalyzeRequest, generateSimilarQuestionRequest, generateReanswerRequest, generateGeogebraRequest, generateMasteryRequest, generateGradingRequest, generateTagSuggestRequest, generateFigureRequest, generateSvgAnimationRequest, generateSvgNarrationRequest, generateLatexFixRequest, generateQuestionSplitRequest, generateTextFixRequest } from './prompt-requests';
import { parseNarration, sanitizeSvgAnimation } from '../svg-animation';
import type { NarrationSegment } from '../svg-animation';
import { parseLatexFix } from './latex-fix';
import { getAppConfig } from '../config';
import { parseGradeRecognition, parseMasteryEvaluation, parseAnswerGrading, normalizeSubject, parseTagSuggestion, parseDifficultyStars, parseQuestionType, parseFigure } from './schema';
import { extractTag, parseQuestionResponse, splitKnowledgePoints } from './response-parser';
import { prefetchSubjectTags } from './tag-service';
import { createLogger } from '../logger';
import { parseErrorCode } from './error-classification';
import { normalizeMistakeStatusForSave } from '@/lib/question/mistake-status';
import { parseRecognizedGrade } from '@/lib/question/question-grade';
import { normalizeGeneratedQuestion } from './generated-question';
import { normalizeAiQuestionTags } from './knowledge-points';
import { isImageUnsupportedError, parseQuestionSplit, AI_IMAGE_NOT_SUPPORTED } from './question-split';
import { parseTextFix } from './text-fix';
import type { CompletionObserver, CompletionResult } from './completion';
import { completionErrorCode } from './completion';

const logger = createLogger('ai:base');

/** 一次补全请求：system 为系统提示词，user 为用户提示词，image 为可选图片 */
export interface CompletionImage {
    base64: string;
    mimeType?: string;
}

export type CompletionTask =
    | 'analyze'
    | 'similar'
    | 'reanswer'
    | 'geogebra'
    | 'mastery'
    | 'recognize-grade'
    | 'grading'
    | 'tag-suggest'
    | 'figure'
    | 'latex-fix'
    | 'svg-animation'
    | 'svg-narration'
    | 'question-split'
    | 'text-fix';

export interface CompletionRequest {
    task: CompletionTask;
    system: string;
    user: string;
    image?: CompletionImage;
    /** 附加在图片后的额外文字（如配图重绘时的提示） */
    extraUserText?: string;
}

/**
 * AI 提供商公共基类：实现 AIService 的 14 个业务方法。
 * 子类只需实现 providerName（日志用）、configuredModel 和 complete（调用各自 SDK，返回正文、用量与请求 ID）。
 * 业务方法统一经 run 调用 complete，run 负责计时并通知补全观察者。
 */
export abstract class BaseAIProvider implements AIService {
    protected abstract readonly providerName: string;
    /** 发送一次补全，返回正文及 token 用量、实际模型和请求 ID */
    protected abstract complete(request: CompletionRequest): Promise<CompletionResult>;
    /** 配置的模型名，服务商未返回实际模型时用于记录 */
    protected abstract readonly configuredModel: string;

    private completionObserver?: CompletionObserver;

    /** 设置补全观察者：每次补全结束（成功或失败）后收到一条记录 */
    observeCompletions(observer: CompletionObserver | undefined): void {
        this.completionObserver = observer;
    }

    /** 执行一次补全并通知观察者，返回正文；观察者出错只记日志，不影响调用结果 */
    protected async run(request: CompletionRequest): Promise<string> {
        const startedAt = Date.now();
        try {
            const result = await this.complete(request);
            this.notifyCompletion({
                task: request.task,
                status: 'succeeded',
                durationMs: Date.now() - startedAt,
                usage: result.usage,
                model: result.model || this.configuredModel,
                requestId: result.requestId,
            });
            return result.text;
        } catch (error) {
            this.notifyCompletion({
                task: request.task,
                status: 'failed',
                durationMs: Date.now() - startedAt,
                model: this.configuredModel,
                errorCode: completionErrorCode(error),
            });
            throw error;
        }
    }

    private notifyCompletion(event: Parameters<CompletionObserver>[0]): void {
        const observer = this.completionObserver;
        if (!observer) return;
        try {
            Promise.resolve(observer(event)).catch((error: unknown) => {
                logger.error({ error, task: event.task }, 'AI completion observer failed');
            });
        } catch (error) {
            logger.error({ error, task: event.task }, 'AI completion observer failed');
        }
    }

    protected handleError(error: unknown): void {
        logger.error({ error }, 'AI provider error');
        if (error instanceof Error) {
            if (error.message.startsWith('AI_RESPONSE_ERROR:')) {
                throw error;
            }
        }
        const code = parseErrorCode(error);
        throw new Error(code, { cause: error });
    }

    async analyzeImage(imageBase64: string, mimeType: string = "image/jpeg", language: 'zh' | 'en' = 'zh', grade?: GradeLevel | null, subject?: string | null, gradeSemester?: string | null, candidateTags?: CandidateTags, referenceText?: string | null): Promise<ParsedQuestion> {
        const config = getAppConfig();
        const tagOptions = candidateTags ? { candidateTags } : await prefetchSubjectTags(subject, grade);
        const systemPrompt = generateAnalyzeRequest(language, grade, subject, {
            customTemplate: config.prompts?.analyze,
            ...tagOptions,
        }, gradeSemester, referenceText);

        logger.box('🔍 AI Image Analysis Request', {
            provider: this.providerName,
            imageSize: `${imageBase64.length} bytes`,
            mimeType,
            language,
            grade: grade || 'all'
        });
        logger.box('📝 Full System Prompt', systemPrompt.system);

        try {
            const text = await this.run({ task: 'analyze', system: systemPrompt.system, user: systemPrompt.user, image: { base64: imageBase64, mimeType } });
            logger.box('🤖 AI Raw Response', text);
            const parsedResult = normalizeAiQuestionTags(parseQuestionResponse(text), tagOptions);
            logger.box('✅ Parsed & Validated Result', JSON.stringify(parsedResult, null, 2));
            return parsedResult;
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during AI analysis');
            this.handleError(error);
            throw error;
        }
    }

    async generateSimilarQuestion(originalQuestion: string, knowledgePoints: string[], language: 'zh' | 'en' = 'zh', difficulty: DifficultyLevel = 'medium', gradeSemester?: string | null, originalFigureSvg?: string | null): Promise<ParsedQuestion> {
        const config = getAppConfig();
        const systemPrompt = generateSimilarQuestionRequest(language, originalQuestion, knowledgePoints, difficulty, {
            customTemplate: config.prompts?.similar,
            originalFigureSvg,
        }, gradeSemester);
        const userPrompt = systemPrompt.user;

        logger.info({ provider: this.providerName, difficulty, language }, 'Generate Similar Question Request');

        try {
            const text = await this.run({ task: 'similar', system: systemPrompt.system, user: userPrompt });
            logger.box('🤖 AI Raw Response', text);
            return normalizeGeneratedQuestion(parseQuestionResponse(text));
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during question generation');
            this.handleError(error);
            throw error;
        }
    }

    async reanswerQuestion(questionText: string, language: 'zh' | 'en' = 'zh', subject?: string | null, imageBase64?: string, gradeSemester?: string | null, candidateTags?: CandidateTags): Promise<ReanswerQuestionResult> {
        const prompt = generateReanswerRequest(language, questionText, subject, { candidateTags }, gradeSemester);

        logger.info({
            provider: this.providerName,
            questionLength: questionText.length,
            subject: subject || 'auto',
            hasImage: !!imageBase64
        }, 'Reanswer Question Request');

        try {
            const text = await this.run({ task: 'reanswer', system: prompt.system, user: prompt.user, image: imageBase64 ? { base64: imageBase64 } : undefined });
            logger.debug({ rawResponse: text }, 'AI raw response');

            const wrongAnswerText = extractTag(text, "wrong_answer_text") || "";
            return normalizeAiQuestionTags({
                answerText: extractTag(text, "answer_text") || "",
                analysis: extractTag(text, "analysis") || "",
                knowledgePoints: splitKnowledgePoints(extractTag(text, "knowledge_points")),
                wrongAnswerText,
                mistakeAnalysis: extractTag(text, "mistake_analysis") || "",
                mistakeStatus: normalizeMistakeStatusForSave(extractTag(text, "mistake_status"), wrongAnswerText),
                subject: normalizeSubject(extractTag(text, "subject")),
                gradeSemester: parseRecognizedGrade(extractTag(text, "grade_semester")),
                difficultyStars: parseDifficultyStars(extractTag(text, "difficulty_stars")),
                questionType: parseQuestionType(extractTag(text, "question_type")),
            }, { candidateTags });
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during reanswer');
            this.handleError(error);
            throw error;
        }
    }

    async analyzeForGeogebra(questionText: string, answerText: string, analysis: string, previousErrors?: string): Promise<GeogebraAnalysisResult> {
        const prompt = generateGeogebraRequest(questionText, answerText, analysis, previousErrors);
        logger.info({ provider: this.providerName, questionLength: questionText.length }, 'GeoGebra Analysis Request');

        try {
            const text = await this.run({ task: 'geogebra', system: prompt.system, user: prompt.user });
            logger.debug({ rawResponse: text }, 'GeoGebra AI raw response');
            const parsed = extractJsonObject(text) as { suitable?: unknown; commands?: unknown; description?: unknown };
            return {
                suitable: Boolean(parsed.suitable),
                commands: Array.isArray(parsed.commands) ? parsed.commands : [],
                description: typeof parsed.description === 'string' ? parsed.description : "",
            };
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during GeoGebra analysis');
            this.handleError(error);
            throw error;
        }
    }

    async evaluateMastery(input: MasteryEvaluationInput): Promise<MasteryEvaluationResult> {
        const prompt = generateMasteryRequest(input);
        logger.info({ provider: this.providerName, historyCount: input.history.length }, 'Mastery Evaluation Request');

        try {
            const text = await this.run({ task: 'mastery', system: prompt.system, user: prompt.user });
            logger.debug({ rawResponse: text }, 'Mastery AI raw response');
            return parseMasteryEvaluation(text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during mastery evaluation');
            this.handleError(error);
            throw error;
        }
    }

    async recognizeGrade(questionText: string): Promise<string | null> {
        const prompt = generateGradeRecognitionRequest(questionText);
        try {
            const text = await this.run({ task: 'recognize-grade', system: prompt.system, user: prompt.user });
            return parseGradeRecognition(text);
        } catch (error) {
            logger.error({ error }, '识别题目年级失败');
            this.handleError(error);
            throw error;
        }
    }

    async gradeAnswer(input: AnswerGradingInput): Promise<AnswerGradingResult> {
        const prompt = generateGradingRequest(input);
        logger.info({ provider: this.providerName }, 'Answer Grading Request');

        try {
            const text = await this.run({ task: 'grading', system: prompt.system, user: prompt.user });
            logger.debug({ rawResponse: text }, 'Grading AI raw response');
            return parseAnswerGrading(text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during answer grading');
            this.handleError(error);
            throw error;
        }
    }

    async suggestKnowledgeTags(input: TagSuggestionInput): Promise<TagSuggestionResult> {
        const prompt = generateTagSuggestRequest(input);
        logger.info({ provider: this.providerName, subject: input.subject, allowedTagCount: input.allowedTags.length }, 'Tag Suggestion Request');

        try {
            const text = await this.run({ task: 'tag-suggest', system: prompt.system, user: prompt.user });
            logger.debug({ rawResponse: text }, 'Tag suggestion AI raw response');
            return parseTagSuggestion(text, input.allowedTags);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during tag suggestion');
            this.handleError(error);
            throw error;
        }
    }

    async generateFigureSvg(imageBase64: string, mimeType: string, questionText?: string | null): Promise<FigureResult> {
        const prompt = generateFigureRequest(questionText);
        logger.info({ provider: this.providerName, imageSize: imageBase64.length }, 'Figure SVG Request');

        try {
            const text = await this.run({ task: 'figure', system: prompt.system, user: prompt.user, image: { base64: imageBase64, mimeType }, extraUserText: '请重新绘制图中题目的配图。' });
            logger.debug({ rawResponse: text }, 'Figure SVG AI raw response');
            return parseFigure(extractTag(text, "has_figure"), extractTag(text, "figure_svg"));
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during figure SVG generation');
            this.handleError(error);
            throw error;
        }
    }

    async fixLatex(input: LatexFixInput): Promise<LatexFixResult> {
        const prompt = generateLatexFixRequest(input);
        logger.info({ provider: this.providerName, fields: Object.keys(input) }, 'LaTeX Fix Request');

        try {
            const text = await this.run({ task: 'latex-fix', system: prompt.system, user: prompt.user });
            logger.debug({ rawResponse: text }, 'LaTeX fix AI raw response');
            return parseLatexFix(text, input);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during LaTeX fix');
            this.handleError(error);
            throw error;
        }
    }

    async generateSvgAnimation(questionText: string, answerText: string, analysis: string, figureSvg?: string | null, language: 'zh' | 'en' = 'zh'): Promise<string | null> {
        const prompt = generateSvgAnimationRequest(questionText, answerText, analysis, figureSvg, language);
        logger.info({ provider: this.providerName, questionLength: questionText.length }, 'SVG Animation Request');

        try {
            const text = await this.run({ task: 'svg-animation', system: prompt.system, user: prompt.user });
            logger.debug({ rawResponse: text }, 'SVG animation AI raw response');
            return sanitizeSvgAnimation(extractTag(text, "svg_animation") || text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during SVG animation generation');
            this.handleError(error);
            throw error;
        }
    }

    async generateSvgNarration(questionText: string, answerText: string, analysis: string, svgAnimation: string, language: 'zh' | 'en' = 'zh'): Promise<NarrationSegment[] | null> {
        const prompt = generateSvgNarrationRequest(questionText, answerText, analysis, svgAnimation, language);
        logger.info({ provider: this.providerName, svgLength: svgAnimation.length }, 'SVG Narration Request');

        try {
            const text = await this.run({ task: 'svg-narration', system: prompt.system, user: prompt.user });
            logger.debug({ rawResponse: text }, 'SVG narration AI raw response');
            return parseNarration(extractTag(text, "narration") || text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during SVG narration generation');
            this.handleError(error);
            throw error;
        }
    }

    async splitQuestions(input: QuestionSplitInput): Promise<QuestionSplitResult> {
        const prompt = generateQuestionSplitRequest(input);
        logger.info({ provider: this.providerName, kind: input.kind }, 'Question Split Request');
        const image = input.kind === 'image' ? { base64: input.imageBase64, mimeType: input.mimeType } : undefined;

        try {
            const text = await this.run({ task: 'question-split', system: prompt.system, user: prompt.user, image });
            logger.debug({ rawResponse: text }, 'Question split AI raw response');
            return parseQuestionSplit(text, input);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during question split');
            if (input.kind === 'image' && isImageUnsupportedError(error)) throw new Error(AI_IMAGE_NOT_SUPPORTED, { cause: error });
            this.handleError(error);
            throw error;
        }
    }

    async fixQuestionText(input: TextFixInput): Promise<TextFixResult> {
        const prompt = generateTextFixRequest(input);
        logger.info({ provider: this.providerName, questions: input.length }, 'Text Fix Request');

        try {
            const text = await this.run({ task: 'text-fix', system: prompt.system, user: prompt.user });
            logger.debug({ rawResponse: text }, 'Text fix AI raw response');
            return parseTextFix(text, input);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during text fix');
            this.handleError(error);
            throw error;
        }
    }
}

/** 从模型回复中提取 JSON 对象（兼容 markdown 代码块） */
function extractJsonObject(text: string): Record<string, unknown> {
    let jsonStr = text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
    }
    const objStart = jsonStr.indexOf('{');
    const objEnd = jsonStr.lastIndexOf('}');
    if (objStart !== -1 && objEnd !== -1) {
        jsonStr = jsonStr.substring(objStart, objEnd + 1);
    }
    return JSON.parse(jsonStr);
}

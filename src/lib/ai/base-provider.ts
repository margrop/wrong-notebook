import "server-only";

import type { AIService, GradeLevel, ParsedQuestion, DifficultyLevel, ReanswerQuestionResult, GeogebraAnalysisResult, MasteryEvaluationInput, MasteryEvaluationResult, AnswerGradingInput, AnswerGradingResult, TagSuggestionInput, TagSuggestionResult, CandidateTags, FigureResult } from "./types";
import type { LatexFixInput, LatexFixResult } from './latex-fix';
import type { QuestionSplitInput, QuestionSplitResult } from './question-split';
import type { TextFixInput, TextFixResult } from './text-fix';
import { generateGradeRecognitionRequest, generateAnalyzeRequest, generateSimilarQuestionRequest, generateReanswerRequest, generateGeogebraRequest, generateMasteryRequest, generateGradingRequest, generateTagSuggestRequest, generateFigureRequest, generateFigureFixRequest, generateFigureReviewRequest, generateSvgAnimationRequest, generateSvgNarrationRequest, generateLatexFixRequest, generateQuestionSplitRequest, generateTextFixRequest } from './prompt-requests';
import { parseNarration, sanitizeSvgAnimation } from '../svg-animation';
import type { NarrationSegment } from '../svg-animation';
import { parseLatexFix } from './latex-fix';
import { getAppConfig } from '../config';
import { parseGradeRecognition, parseMasteryEvaluation, parseAnswerGrading, normalizeSubject, parseTagSuggestion, parseDifficultyStars, parseQuestionType, parseFigure } from './schema';
import { extractTag, parseQuestionResponse, splitKnowledgePoints } from './response-parser';
import { prefetchSubjectTags } from './tag-service';
import { createLogger } from '../logger';
import { sanitizeFigureSvg } from '../figure-svg';
import { findSvgXmlError, repairSvgEntities } from './figure-validate';
import { parseFigureBox } from './figure-box';
import type { FigureBox } from './figure-box';
import { prepareFigureImage, renderFigureComparison } from './figure-image';
import type { PreparedFigureImage } from './figure-image';
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

/**
 * 单次 AI 调用（含 SDK 内部重试）的总时限，与 SDK 单次请求的默认超时相同。
 * SDK 超时后还会再重试 2 次，推理模型看大图时最坏要等 30 分钟以上才失败，后台分题与识别任务会一直停在「识别中」；
 * 加上总时限后，超时即按 AI_TIMEOUT_ERROR 失败，可重试。
 */
export const AI_CALL_DEADLINE_MS = 10 * 60 * 1000;

/** Vercel 上的总时限：函数最长运行 300 秒（vercel.json 的 maxDuration），须在函数被强制结束前超时，才能返回明确的超时错误 */
export const VERCEL_AI_CALL_DEADLINE_MS = 280 * 1000;

/** 当前部署环境下单次 AI 调用的总时限 */
export function aiCallDeadlineMs(): number {
    return process.env.VERCEL ? VERCEL_AI_CALL_DEADLINE_MS : AI_CALL_DEADLINE_MS;
}

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
    /** 总时限到期时中止请求；由 run 设置，各提供商透传给 SDK */
    signal?: AbortSignal;
    /** 同一业务流程的截止时刻（毫秒时间戳）；多次调用共用 Vercel 函数时长时，本次调用不得超过它 */
    deadlineAt?: number;
}

/** 配图重绘的参数 */
interface FigureOptions {
    /** 识别时给出的配图位置；有值时先裁剪出该区域再重绘 */
    box?: FigureBox | null;
    /** 整个流程的截止时刻（毫秒时间戳）；undefined 表示每次调用各自计时 */
    deadlineAt?: number;
}

/** 识别后剩余时间少于此值时不再单独重绘配图（Vercel 函数时长有限），用户可在校对页重新生成 */
export const MIN_FIGURE_REDRAW_MS = 45 * 1000;

/** Vercel 上多次 AI 调用共用一次函数时长，返回流程的截止时刻；其他部署环境每次调用各自计时，返回 undefined */
function flowDeadline(startedAt: number): number | undefined {
    return process.env.VERCEL ? startedAt + VERCEL_AI_CALL_DEADLINE_MS : undefined;
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
            const result = await this.completeBeforeDeadline(request);
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

    /** 在总时限内完成补全；到期时中止请求（含 SDK 内部重试），按 AI_TIMEOUT_ERROR 失败 */
    private async completeBeforeDeadline(request: CompletionRequest): Promise<CompletionResult> {
        const deadlineMs = request.deadlineAt === undefined
            ? aiCallDeadlineMs()
            : Math.min(aiCallDeadlineMs(), request.deadlineAt - Date.now());
        if (deadlineMs <= 0) throw new Error('AI_TIMEOUT_ERROR');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('AI_TIMEOUT_ERROR')), deadlineMs);
        try {
            return await this.complete({ ...request, signal: controller.signal });
        } catch (error) {
            if (!controller.signal.aborted) throw error;
            logger.warn({ provider: this.providerName, task: request.task, deadlineMs }, 'AI request exceeded deadline');
            throw new Error('AI_TIMEOUT_ERROR', { cause: error });
        } finally {
            clearTimeout(timer);
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

        const startedAt = Date.now();
        try {
            const text = await this.run({ task: 'analyze', system: systemPrompt.system, user: systemPrompt.user, image: { base64: imageBase64, mimeType } });
            logger.box('🤖 AI Raw Response', text);
            const parsedResult = normalizeAiQuestionTags(parseQuestionResponse(text), tagOptions);
            logger.box('✅ Parsed & Validated Result', JSON.stringify(parsedResult, null, 2));
            return await this.redrawAnalyzedFigure(parsedResult, imageBase64, mimeType, parseFigureBox(extractTag(text, "figure_box")), startedAt);
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
        const prompt = generateReanswerRequest(language, questionText, subject, {
            candidateTags,
            customTemplate: getAppConfig().prompts?.reanswer,
        }, gradeSemester);

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
        logger.info({ provider: this.providerName, subject: input.subject, allowedTagCount: input.allowedTags.length, allowCustom: input.allowCustom === true }, 'Tag Suggestion Request');

        try {
            const text = await this.run({ task: 'tag-suggest', system: prompt.system, user: prompt.user });
            logger.debug({ rawResponse: text }, 'Tag suggestion AI raw response');
            return parseTagSuggestion(text, input.allowedTags, input.allowCustom === true);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during tag suggestion');
            this.handleError(error);
            throw error;
        }
    }

    /**
     * 识别完成后单独重绘配图：识别只给出配图位置，这里裁剪出配图区域后专门画 SVG。
     * 重绘失败或剩余时间不足时不影响识别结果，配图留空（识别回复中若仍带 SVG，校验后沿用），用户可在校对页重新生成。
     */
    private async redrawAnalyzedFigure(parsed: ParsedQuestion, imageBase64: string, mimeType: string, box: FigureBox | null, startedAt: number): Promise<ParsedQuestion> {
        if (!parsed.hasFigure) return parsed;
        const deadlineAt = flowDeadline(startedAt);
        const fallback = async () => ({
            ...parsed,
            figureSvg: parsed.figureSvg ? await this.ensureValidFigureSvg(parsed.figureSvg, deadlineAt) : null,
        });
        if (deadlineAt !== undefined && deadlineAt - Date.now() < MIN_FIGURE_REDRAW_MS) {
            logger.warn({ provider: this.providerName, remainingMs: deadlineAt - Date.now() }, 'Not enough time left to redraw figure after analysis');
            return fallback();
        }
        try {
            const figure = await this.drawFigure(imageBase64, mimeType, parsed.questionText, { box, deadlineAt });
            if (figure.figureSvg) return { ...parsed, figureSvg: figure.figureSvg };
            logger.warn({ provider: this.providerName, hasBox: !!box }, 'Figure redraw returned no valid SVG');
        } catch (error) {
            logger.warn({ provider: this.providerName, error }, 'Figure redraw after analysis failed');
        }
        return fallback();
    }

    async generateFigureSvg(imageBase64: string, mimeType: string, questionText?: string | null): Promise<FigureResult> {
        try {
            return await this.drawFigure(imageBase64, mimeType, questionText, { deadlineAt: flowDeadline(Date.now()) });
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during figure SVG generation');
            this.handleError(error);
            throw error;
        }
    }

    /** 重绘配图：准备图片（按位置裁剪、统一尺寸）→ 画 SVG → 校验 XML */
    private async drawFigure(imageBase64: string, mimeType: string, questionText: string | null | undefined, options: FigureOptions): Promise<FigureResult> {
        const image = await prepareFigureImage(imageBase64, mimeType, options.box ?? null);
        const canvas = image.width && image.height ? { width: image.width, height: image.height, cropped: image.cropped } : null;
        const prompt = generateFigureRequest(questionText, canvas);
        logger.info({ provider: this.providerName, imageSize: image.base64.length, canvas }, 'Figure SVG Request');

        const text = await this.run({
            task: 'figure',
            system: prompt.system,
            user: prompt.user,
            image: { base64: image.base64, mimeType: image.mimeType },
            extraUserText: '请重新绘制图中题目的配图。',
            deadlineAt: options.deadlineAt,
        });
        logger.debug({ rawResponse: text }, 'Figure SVG AI raw response');
        const figure = parseFigure(extractTag(text, "has_figure"), extractTag(text, "figure_svg"));
        if (!figure.figureSvg) return figure;
        const figureSvg = await this.ensureValidFigureSvg(figure.figureSvg, options.deadlineAt);
        if (!figureSvg || getAppConfig().figureReview !== true) return { ...figure, figureSvg };
        return { ...figure, figureSvg: await this.reviewFigure(image, figureSvg, questionText, options.deadlineAt) };
    }

    /**
     * 比对校正（系统设置开启时）：把原配图与 SVG 渲染结果并排交给模型，找出差异并修正。
     * 无法渲染对比图、剩余时间不足、调用失败或修正结果无效时保留原 SVG。
     */
    private async reviewFigure(image: PreparedFigureImage, figureSvg: string, questionText: string | null | undefined, deadlineAt: number | undefined): Promise<string> {
        if (!image.width || !image.height) return figureSvg;
        if (deadlineAt !== undefined && deadlineAt - Date.now() < MIN_FIGURE_REDRAW_MS) return figureSvg;
        const prompt = generateFigureReviewRequest(questionText, figureSvg, { width: image.width, height: image.height, cropped: image.cropped });
        const comparison = prompt ? await renderFigureComparison(image, figureSvg) : null;
        if (!prompt || !comparison) return figureSvg;

        try {
            const text = await this.run({ task: 'figure', system: prompt.system, user: prompt.user, image: { base64: comparison, mimeType: 'image/png' }, deadlineAt });
            const differences = extractTag(text, "figure_differences")?.trim() || '';
            const revised = sanitizeFigureSvg(extractTag(text, "figure_svg"));
            if (!revised) {
                logger.info({ provider: this.providerName, differences }, 'Figure self-check kept the SVG');
                return figureSvg;
            }
            const valid = await this.ensureValidFigureSvg(revised, deadlineAt);
            logger.info({ provider: this.providerName, differences, revised: !!valid }, 'Figure self-check revised the SVG');
            return valid ?? figureSvg;
        } catch (error) {
            logger.warn({ provider: this.providerName, error }, 'Figure self-check failed, keeping the SVG');
            return figureSvg;
        }
    }

    /**
     * 保证配图是合法 XML：先本地修复实体，仍不合法时把解析错误交给模型修正一次。
     * 修不好时返回 null，不保存浏览器显示不出来的配图；修正调用失败不影响已有结果。
     */
    protected async ensureValidFigureSvg(svg: string, deadlineAt?: number): Promise<string | null> {
        const repaired = repairSvgEntities(svg);
        const xmlError = findSvgXmlError(repaired);
        if (!xmlError) return repaired;
        logger.warn({ provider: this.providerName, xmlError }, 'Figure SVG is not well-formed XML, asking AI to fix');

        try {
            const prompt = generateFigureFixRequest(repaired, xmlError);
            const text = await this.run({ task: 'figure', system: prompt.system, user: prompt.user, deadlineAt });
            const fixed = sanitizeFigureSvg(extractTag(text, "figure_svg"));
            const result = fixed ? repairSvgEntities(fixed) : null;
            const remaining = result ? findSvgXmlError(result) : 'no svg';
            if (result && !remaining) return result;
            logger.warn({ provider: this.providerName, xmlError: remaining }, 'Figure SVG still invalid after AI fix, dropping it');
        } catch (error) {
            logger.warn({ provider: this.providerName, error }, 'Figure SVG fix request failed, dropping invalid figure');
        }
        return null;
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

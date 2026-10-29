import Anthropic from "@anthropic-ai/sdk";
import { AIService, GradeLevel, ParsedQuestion, DifficultyLevel, AIConfig, ReanswerQuestionResult, GeogebraAnalysisResult, MasteryEvaluationInput, MasteryEvaluationResult, AnswerGradingInput, AnswerGradingResult, TagSuggestionInput, TagSuggestionResult, CandidateTags, FigureResult } from "./types";
import { generateAnalyzePrompt, generateSimilarQuestionPrompt, generateGeogebraPrompt, generateMasteryPrompt, generateGradingPrompt, generateTagSuggestPrompt, generateReanswerPrompt, generateFigurePrompt, generateSvgAnimationPrompt, generateSvgNarrationPrompt, generateLatexFixPrompt, SVG_ANIMATION_REQUEST, SVG_NARRATION_REQUEST } from './prompts';
import { parseNarration, sanitizeSvgAnimation } from '../svg-animation';
import type { NarrationSegment } from '../svg-animation';
import { parseLatexFix } from './latex-fix';
import type { LatexFixInput, LatexFixResult } from './latex-fix';
import { getAppConfig } from '../config';
import { safeParseParsedQuestion, parseMasteryEvaluation, parseAnswerGrading, normalizeSubject, parseTagSuggestion, extractJsonObject, parseDifficultyStars, parseFigure } from './schema';
import { prefetchSubjectTags } from './tag-service';
import { createLogger } from '../logger';
import { trimTrailingSlashes } from '../utils';
import { AI_OUTPUT_TRUNCATED, withTruncationRetry } from './truncation';
import { normalizeMistakeStatusForSave } from '../mistake-status';
import { normalizeGeneratedQuestion } from './generated-question';

const logger = createLogger('ai:anthropic');

export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

// 显式指定请求超时：SDK 在未指定超时且 max_tokens 较大时会拒绝非流式请求
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
type UserContent = string | Anthropic.ContentBlockParam[];

function toImageMediaType(mimeType: string | undefined): ImageMediaType {
    const normalized = (mimeType || '').toLowerCase();
    if (normalized === 'image/png' || normalized === 'image/gif' || normalized === 'image/webp') {
        return normalized;
    }
    return 'image/jpeg';
}

function imageBlock(base64: string, mimeType?: string): Anthropic.ImageBlockParam {
    // 兼容 data URL（data:image/png;base64,xxx）和纯 base64
    const match = base64.match(/^data:([^;]+);base64,([\s\S]*)$/);
    return {
        type: 'image',
        source: {
            type: 'base64',
            media_type: toImageMediaType(match ? match[1] : mimeType),
            data: match ? match[2] : base64,
        },
    };
}

/** 提取 <tag>…</tag> 内容；analysis 未闭合时视为被截断，读取到末尾 */
function extractTag(text: string, tagName: string): string | null {
    const startTag = `<${tagName}>`;
    const endTag = `</${tagName}>`;
    const startIndex = text.indexOf(startTag);
    if (startIndex === -1) {
        return null;
    }

    const contentStartIndex = startIndex + startTag.length;
    const endIndex = text.lastIndexOf(endTag);
    if (endIndex === -1 && tagName === 'analysis') {
        logger.warn({ tagName }, 'Tag was verified unclosed, treating as truncated and reading to end');
        return text.substring(contentStartIndex).trim();
    }
    if (endIndex === -1 || contentStartIndex >= endIndex) {
        return null;
    }
    return text.substring(contentStartIndex, endIndex).trim();
}

function splitKnowledgePoints(raw: string | null): string[] {
    return (raw || '').split(/[,，\n]/).map(k => k.trim()).filter(k => k.length > 0);
}

function parseQuestionResponse(text: string): ParsedQuestion {
    const questionText = extractTag(text, "question_text");
    const answerText = extractTag(text, "answer_text");
    const analysis = extractTag(text, "analysis");
    if (!questionText || !answerText || !analysis) {
        logger.error({ rawTextSample: text.substring(0, 500) }, 'Missing critical XML tags');
        throw new Error("Invalid AI response: Missing critical XML tags (<question_text>, <answer_text>, or <analysis>)");
    }

    const wrongAnswerText = extractTag(text, "wrong_answer_text") || "";
    const result: ParsedQuestion = {
        questionText,
        answerText,
        analysis,
        wrongAnswerText,
        mistakeAnalysis: extractTag(text, "mistake_analysis") || "",
        mistakeStatus: normalizeMistakeStatusForSave(extractTag(text, "mistake_status"), wrongAnswerText),
        subject: normalizeSubject(extractTag(text, "subject")) || '其他',
        knowledgePoints: splitKnowledgePoints(extractTag(text, "knowledge_points")),
        requiresImage: extractTag(text, "requires_image")?.toLowerCase().trim() === 'true',
        difficultyStars: parseDifficultyStars(extractTag(text, "difficulty_stars")),
        ...parseFigure(extractTag(text, "has_figure"), extractTag(text, "figure_svg")),
    };

    const validation = safeParseParsedQuestion(result);
    if (!validation.success) {
        logger.warn({ validationError: validation.error.format() }, 'Schema validation warning');
        return result;
    }
    return validation.data;
}

/**
 * Anthropic Messages API 及其兼容接口（如各家模型的 /anthropic 端点）
 */
export class AnthropicProvider implements AIService {
    private client: Anthropic;
    private model: string;
    private baseURL: string;

    constructor(config?: AIConfig) {
        const apiKey = config?.apiKey;
        const authToken = config?.authToken;
        if (!apiKey && !authToken) {
            throw new Error("AI_AUTH_ERROR: ANTHROPIC_API_KEY is required for Anthropic provider");
        }

        // SDK 会自动拼接 /v1/messages，这里去掉用户可能多填的 /v1 和末尾斜杠
        this.baseURL = trimTrailingSlashes(config?.baseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/v1$/, '');
        this.model = config?.model || DEFAULT_ANTHROPIC_MODEL;
        // authToken 以 Authorization: Bearer 发送（OAuth 登录的渠道）；显式传 null，避免 SDK 读取环境变量里的 ANTHROPIC_API_KEY
        this.client = apiKey
            ? new Anthropic({ apiKey, baseURL: this.baseURL, timeout: REQUEST_TIMEOUT_MS })
            : new Anthropic({ apiKey: null, authToken, baseURL: this.baseURL, timeout: REQUEST_TIMEOUT_MS });

        logger.info({
            provider: 'Anthropic',
            model: this.model,
            baseURL: this.baseURL,
            apiKeyPrefix: apiKey ? apiKey.substring(0, 8) + '...' : 'bearer'
        }, 'AI Provider initialized');
    }

    /** 发送一次单轮对话并返回正文；正文为空且因长度截断时用更大的上限重试 */
    private async complete(system: string, content: UserContent, maxTokens: number): Promise<string> {
        const response = await withTruncationRetry(async (limit) => {
            const message = await this.client.messages.create({
                model: this.model,
                max_tokens: limit,
                system,
                messages: [{ role: 'user', content }],
            });
            // 兼容接口的推理模型会返回 thinking 块，只取正文
            const text = message.content
                .filter((block): block is Anthropic.TextBlock => block.type === 'text')
                .map(block => block.text)
                .join('');
            logger.debug({ stopReason: message.stop_reason, usage: message.usage }, 'Anthropic response received');
            return {
                text,
                choices: [{ finish_reason: message.stop_reason === 'max_tokens' ? 'length' : message.stop_reason, message: { content: text } }],
            };
        }, maxTokens, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

        if (!response.text) throw new Error("Empty response from AI");
        return response.text;
    }

    async analyzeImage(imageBase64: string, mimeType: string = "image/jpeg", language: 'zh' | 'en' = 'zh', grade?: GradeLevel | null, subject?: string | null, gradeSemester?: string | null, candidateTags?: CandidateTags): Promise<ParsedQuestion> {
        const config = getAppConfig();
        const systemPrompt = generateAnalyzePrompt(language, grade, subject, {
            customTemplate: config.prompts?.analyze,
            // 有错题本学段 + 学科时直接使用其全部知识点，否则按学科、年级取标签
            ...(candidateTags ? { candidateTags } : await prefetchSubjectTags(subject, grade)),
        }, gradeSemester);

        logger.box('🔍 AI Image Analysis Request', {
            provider: 'Anthropic',
            endpoint: `${this.baseURL}/v1/messages`,
            imageSize: `${imageBase64.length} bytes`,
            mimeType,
            model: this.model,
            language,
            grade: grade || 'all'
        });
        logger.box('📝 Full System Prompt', systemPrompt);

        try {
            const text = await this.complete(systemPrompt, [
                imageBlock(imageBase64, mimeType),
                { type: 'text', text: language === 'zh' ? '请分析图片中的题目。' : 'Please analyze the question in the image.' },
            ], 8192);
            logger.box('🤖 AI Raw Response', text);
            const parsedResult = parseQuestionResponse(text);
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
        const systemPrompt = generateSimilarQuestionPrompt(language, originalQuestion, knowledgePoints, difficulty, {
            customTemplate: config.prompts?.similar,
            originalFigureSvg,
        }, gradeSemester);
        const userPrompt = `\nOriginal Question: "${originalQuestion}"\nKnowledge Points: ${knowledgePoints.join(", ")}\n    `;

        logger.info({ provider: 'Anthropic', model: this.model, difficulty, language }, 'Generate Similar Question Request');

        try {
            const text = await this.complete(systemPrompt, userPrompt, 8192);
            logger.box('🤖 AI Raw Response', text);
            return normalizeGeneratedQuestion(parseQuestionResponse(text));
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during question generation');
            this.handleError(error);
            throw error;
        }
    }

    async reanswerQuestion(questionText: string, language: 'zh' | 'en' = 'zh', subject?: string | null, imageBase64?: string, gradeSemester?: string | null, candidateTags?: CandidateTags): Promise<ReanswerQuestionResult> {
        const prompt = generateReanswerPrompt(language, questionText, subject, { candidateTags }, gradeSemester);

        logger.info({
            provider: 'Anthropic',
            model: this.model,
            questionLength: questionText.length,
            subject: subject || 'auto',
            hasImage: !!imageBase64
        }, 'Reanswer Question Request');

        try {
            const content: UserContent = imageBase64
                ? [imageBlock(imageBase64), { type: 'text', text: "请结合图片和题目描述提供答案和解析。" }]
                : "请根据上述题目提供答案和解析。";
            const text = await this.complete(prompt, content, 8192);
            logger.debug({ rawResponse: text }, 'AI raw response');

            const wrongAnswerText = extractTag(text, "wrong_answer_text") || "";
            return {
                answerText: extractTag(text, "answer_text") || "",
                analysis: extractTag(text, "analysis") || "",
                knowledgePoints: splitKnowledgePoints(extractTag(text, "knowledge_points")),
                wrongAnswerText,
                mistakeAnalysis: extractTag(text, "mistake_analysis") || "",
                mistakeStatus: normalizeMistakeStatusForSave(extractTag(text, "mistake_status"), wrongAnswerText),
                subject: normalizeSubject(extractTag(text, "subject")),
                difficultyStars: parseDifficultyStars(extractTag(text, "difficulty_stars")),
            };
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during reanswer');
            this.handleError(error);
            throw error;
        }
    }

    async analyzeForGeogebra(questionText: string, answerText: string, analysis: string, previousErrors?: string): Promise<GeogebraAnalysisResult> {
        const prompt = generateGeogebraPrompt(questionText, answerText, analysis, previousErrors);
        logger.info({ provider: 'Anthropic', model: this.model, questionLength: questionText.length }, 'GeoGebra Analysis Request');

        try {
            const text = await this.complete(prompt, "请分析上述题目并生成 GeoGebra 演示命令。", 4096);
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
        logger.info({ provider: 'Anthropic', historyCount: input.history.length }, 'Mastery Evaluation Request');

        try {
            const text = await this.complete(generateMasteryPrompt(input), "请根据上述练习历史给出掌握概率评估。", 4096);
            logger.debug({ rawResponse: text }, 'Mastery AI raw response');
            return parseMasteryEvaluation(text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during mastery evaluation');
            this.handleError(error);
            throw error;
        }
    }

    async gradeAnswer(input: AnswerGradingInput): Promise<AnswerGradingResult> {
        logger.info({ provider: 'Anthropic' }, 'Answer Grading Request');

        try {
            const text = await this.complete(generateGradingPrompt(input), "请判定学生答案是否正确。", 4096);
            logger.debug({ rawResponse: text }, 'Grading AI raw response');
            return parseAnswerGrading(text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during answer grading');
            this.handleError(error);
            throw error;
        }
    }

    async suggestKnowledgeTags(input: TagSuggestionInput): Promise<TagSuggestionResult> {
        logger.info({ provider: 'Anthropic', subject: input.subject, allowedTagCount: input.allowedTags.length }, 'Tag Suggestion Request');

        try {
            const text = await this.complete(generateTagSuggestPrompt(input), "请为上述题目选择知识点。", 4096);
            logger.debug({ rawResponse: text }, 'Tag suggestion AI raw response');
            return parseTagSuggestion(text, input.allowedTags);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during tag suggestion');
            this.handleError(error);
            throw error;
        }
    }

    async generateFigureSvg(imageBase64: string, mimeType: string, questionText?: string | null): Promise<FigureResult> {
        logger.info({ provider: 'Anthropic', model: this.model, imageSize: imageBase64.length }, 'Figure SVG Request');

        try {
            const text = await this.complete(generateFigurePrompt(questionText), [
                imageBlock(imageBase64, mimeType),
                { type: 'text', text: '请重新绘制图中题目的配图。' },
            ], 8192);
            logger.debug({ rawResponse: text }, 'Figure SVG AI raw response');
            return parseFigure(extractTag(text, "has_figure"), extractTag(text, "figure_svg"));
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during figure SVG generation');
            this.handleError(error);
            throw error;
        }
    }

    async fixLatex(input: LatexFixInput): Promise<LatexFixResult> {
        logger.info({ provider: 'Anthropic', model: this.model, fields: Object.keys(input) }, 'LaTeX Fix Request');

        try {
            const text = await this.complete(generateLatexFixPrompt(input), "请修复上述内容中的 LaTeX 语法。", 8192);
            logger.debug({ rawResponse: text }, 'LaTeX fix AI raw response');
            return parseLatexFix(text, input);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during LaTeX fix');
            this.handleError(error);
            throw error;
        }
    }

    async generateSvgAnimation(questionText: string, answerText: string, analysis: string, figureSvg?: string | null, language: 'zh' | 'en' = 'zh'): Promise<string | null> {
        logger.info({ provider: 'Anthropic', model: this.model, questionLength: questionText.length }, 'SVG Animation Request');

        try {
            const text = await this.complete(generateSvgAnimationPrompt(questionText, answerText, analysis, figureSvg, language), SVG_ANIMATION_REQUEST[language], 16384);
            logger.debug({ rawResponse: text }, 'SVG animation AI raw response');
            return sanitizeSvgAnimation(extractTag(text, "svg_animation") || text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during SVG animation generation');
            this.handleError(error);
            throw error;
        }
    }

    async generateSvgNarration(questionText: string, answerText: string, analysis: string, svgAnimation: string, language: 'zh' | 'en' = 'zh'): Promise<NarrationSegment[] | null> {
        logger.info({ provider: 'Anthropic', model: this.model, svgLength: svgAnimation.length }, 'SVG Narration Request');

        try {
            const text = await this.complete(generateSvgNarrationPrompt(questionText, answerText, analysis, svgAnimation, language), SVG_NARRATION_REQUEST[language], 4096);
            logger.debug({ rawResponse: text }, 'SVG narration AI raw response');
            return parseNarration(extractTag(text, "narration") || text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during SVG narration generation');
            this.handleError(error);
            throw error;
        }
    }

    private handleError(error: unknown) {
        logger.error({ error }, 'Anthropic error');
        if (error instanceof Error && (error.message === AI_OUTPUT_TRUNCATED || error.message.startsWith('AI_RESPONSE_ERROR:'))) {
            throw error;
        }

        // SDK 的 APIError 带 HTTP 状态码，优先按状态码判断
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new Error("AI_TIMEOUT_ERROR");
        if (error instanceof Anthropic.APIConnectionError) throw new Error("AI_CONNECTION_FAILED");
        if (error instanceof Anthropic.APIError && error.status) {
            const status = error.status;
            if (status === 401) throw new Error("AI_AUTH_ERROR");
            if (status === 403) throw new Error("AI_PERMISSION_DENIED");
            if (status === 404) throw new Error("AI_NOT_FOUND");
            if (status === 408) throw new Error("AI_TIMEOUT_ERROR");
            if (status === 429) throw new Error("AI_QUOTA_EXCEEDED");
            if (status >= 500) throw new Error("AI_SERVICE_UNAVAILABLE"); // 含 529 overloaded
        }

        if (error instanceof Error) {
            const msg = error.message.toLowerCase();
            if (msg.includes('fetch failed') || msg.includes('network') || msg.includes('connect')) {
                throw new Error("AI_CONNECTION_FAILED");
            }
            if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
                throw new Error("AI_TIMEOUT_ERROR");
            }
            if (msg.includes('invalid json') || msg.includes('parse') || msg.includes('json') || msg.includes('missing critical xml')) {
                throw new Error("AI_RESPONSE_ERROR");
            }
        }
        throw new Error("AI_UNKNOWN_ERROR");
    }
}

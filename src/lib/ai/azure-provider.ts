import { AzureOpenAI } from "openai";
import { AIService, GradeLevel, ParsedQuestion, DifficultyLevel, ReanswerQuestionResult, GeogebraAnalysisResult, MasteryEvaluationInput, MasteryEvaluationResult, AnswerGradingInput, AnswerGradingResult, TagSuggestionInput, TagSuggestionResult, CandidateTags, FigureResult } from "./types";
import { generateAnalyzePrompt, generateSimilarQuestionPrompt, generateReanswerPrompt, generateGeogebraPrompt, generateMasteryPrompt, generateGradingPrompt, generateTagSuggestPrompt, generateFigurePrompt, generateSvgAnimationPrompt, generateSvgNarrationPrompt, generateLatexFixPrompt, SVG_ANIMATION_REQUEST, SVG_NARRATION_REQUEST } from './prompts';
import { parseNarration, sanitizeSvgAnimation } from '../svg-animation';
import type { NarrationSegment } from '../svg-animation';
import { parseLatexFix } from './latex-fix';
import type { LatexFixInput, LatexFixResult } from './latex-fix';
import { getAppConfig } from '../config';
import { safeParseParsedQuestion, parseMasteryEvaluation, parseAnswerGrading, normalizeSubject, parseTagSuggestion, parseDifficultyStars, parseFigure } from './schema';
import { prefetchSubjectTags } from './tag-service';
import { createLogger } from '../logger';
import { AI_OUTPUT_TRUNCATED, withTruncationRetry } from './truncation';
import { normalizeMistakeStatusForSave } from '../mistake-status';
import { normalizeGeneratedQuestion } from './generated-question';

const logger = createLogger('ai:azure');

type AzureUserContent = string | Array<
    { type: "text"; text: string } |
    { type: "image_url"; image_url: { url: string } }
>;

// Azure 配置接口
export interface AzureConfig {
    apiKey?: string;
    endpoint?: string;       // Azure 资源端点 (https://xxx.openai.azure.com)
    deploymentName?: string; // 部署名称
    apiVersion?: string;     // API 版本
    model?: string;          // 显示用模型名
}

export class AzureOpenAIProvider implements AIService {
    private client: AzureOpenAI;
    private model: string;
    private deployment: string;
    private endpoint: string;

    constructor(config?: AzureConfig) {
        const apiKey = config?.apiKey;
        const endpoint = config?.endpoint;
        const deployment = config?.deploymentName;

        if (!apiKey) {
            throw new Error("AI_AUTH_ERROR: AZURE_OPENAI_API_KEY is required for Azure OpenAI provider");
        }

        if (!endpoint) {
            throw new Error("AI_AUTH_ERROR: AZURE_OPENAI_ENDPOINT is required for Azure OpenAI provider");
        }

        if (!deployment) {
            throw new Error("AI_AUTH_ERROR: AZURE_OPENAI_DEPLOYMENT is required for Azure OpenAI provider");
        }

        this.client = new AzureOpenAI({
            apiKey: apiKey,
            endpoint: endpoint,
            deployment: deployment,
            apiVersion: config?.apiVersion || '2024-02-15-preview',
        });

        this.model = config?.model || deployment;
        this.deployment = deployment;
        this.endpoint = endpoint;

        logger.info({
            provider: 'Azure OpenAI',
            model: this.model,
            deployment: this.deployment,
            endpoint: endpoint,
            apiKeyPrefix: apiKey.substring(0, 8) + '...'
        }, 'Azure AI Provider initialized');
    }

    private extractTag(text: string, tagName: string): string | null {
        const startTag = `<${tagName}>`;
        const endTag = `</${tagName}>`;
        const startIndex = text.indexOf(startTag);
        const endIndex = text.lastIndexOf(endTag);

        if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
            return null;
        }

        return text.substring(startIndex + startTag.length, endIndex).trim();
    }

    private parseResponse(text: string): ParsedQuestion {
        logger.debug({ textLength: text.length }, 'Parsing AI response');

        const questionText = this.extractTag(text, "question_text");
        const answerText = this.extractTag(text, "answer_text");
        const analysis = this.extractTag(text, "analysis");
        const subjectRaw = this.extractTag(text, "subject");
        const knowledgePointsRaw = this.extractTag(text, "knowledge_points");
        const requiresImageRaw = this.extractTag(text, "requires_image");
        const wrongAnswerText = this.extractTag(text, "wrong_answer_text") || "";
        const mistakeAnalysis = this.extractTag(text, "mistake_analysis") || "";
        const mistakeStatusRaw = this.extractTag(text, "mistake_status");

        // Basic Validation
        if (!questionText || !answerText || !analysis) {
            logger.error({ rawTextSample: text.substring(0, 500) }, 'Missing critical XML tags');
            throw new Error("Invalid AI response: Missing critical XML tags (<question_text>, <answer_text>, or <analysis>)");
        }

        // Process Subject
        let subject: ParsedQuestion['subject'] = '其他';
        const validSubjects: ParsedQuestion['subject'][] = ["数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"];
        if (subjectRaw && (validSubjects as string[]).includes(subjectRaw)) {
            subject = subjectRaw as ParsedQuestion['subject'];
        }

        // Process Knowledge Points
        let knowledgePoints: string[] = [];
        if (knowledgePointsRaw) {
            knowledgePoints = knowledgePointsRaw.split(/[,，\n]/).map(k => k.trim()).filter(k => k.length > 0);
        }

        // Process requiresImage
        const requiresImage = requiresImageRaw?.toLowerCase().trim() === 'true';
        const mistakeStatus = normalizeMistakeStatusForSave(mistakeStatusRaw, wrongAnswerText);

        // Construct Result
        const result: ParsedQuestion = {
            questionText,
            answerText,
            analysis,
            wrongAnswerText,
            mistakeAnalysis,
            mistakeStatus,
            subject,
            knowledgePoints,
            requiresImage,
            difficultyStars: parseDifficultyStars(this.extractTag(text, "difficulty_stars")),
            ...parseFigure(this.extractTag(text, "has_figure"), this.extractTag(text, "figure_svg")),
        };

        // Final Schema Validation
        const validation = safeParseParsedQuestion(result);
        if (validation.success) {
            logger.debug('Validated successfully via XML tags');
            return validation.data;
        } else {
            logger.warn({ validationError: validation.error.format() }, 'Schema validation warning');
            return result;
        }
    }

    async analyzeImage(
        imageBase64: string,
        mimeType: string = 'image/jpeg',
        language: 'zh' | 'en' = 'zh',
        grade?: GradeLevel | null,
        subject?: string | null,
        gradeSemester?: string | null,
        candidateTags?: CandidateTags
    ): Promise<ParsedQuestion> {
        const config = getAppConfig();

        // 有错题本学段 + 学科时直接使用其全部知识点，否则按学科、年级取标签
        const tagOptions = candidateTags ? { candidateTags } : await prefetchSubjectTags(subject, grade);

        const systemPrompt = generateAnalyzePrompt(language, grade, subject, {
            customTemplate: config.prompts?.analyze,
            ...tagOptions,
        }, gradeSemester);

        logger.box('🔍 AI Image Analysis Request', {
            provider: 'Azure OpenAI',
            endpoint: this.endpoint,
            imageSize: `${imageBase64.length} bytes`,
            mimeType,
            model: this.model,
            deployment: this.deployment,
            language,
            grade: grade || 'all'
        });
        logger.box('📝 Full System Prompt', systemPrompt);

        try {
            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mimeType};base64,${imageBase64}`,
                                },
                            },
                        ],
                    },
                ],
                max_tokens: maxTokens,
            }), 8192, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            logger.box('📦 Full API Response', JSON.stringify(response, null, 2));

            // 检查响应是否有效
            if (!response || !response.choices || response.choices.length === 0) {
                logger.error({ response: JSON.stringify(response) }, 'Invalid API response - no choices array');
                throw new Error("AI_RESPONSE_ERROR: API returned empty or invalid response");
            }

            const text = response.choices[0]?.message?.content || "";

            logger.box('🤖 AI Raw Response', text);

            if (!text) throw new Error("Empty response from AI");
            const parsedResult = this.parseResponse(text);

            logger.box('✅ Parsed & Validated Result', JSON.stringify(parsedResult, null, 2));

            return parsedResult;

        } catch (error) {
            logger.box('❌ Error during AI analysis', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            this.handleError(error);
            throw error;
        }
    }

    async generateSimilarQuestion(
        originalQuestion: string,
        knowledgePoints: string[],
        language: 'zh' | 'en' = 'zh',
        difficulty: DifficultyLevel = 'medium',
        gradeSemester?: string | null,
        originalFigureSvg?: string | null
    ): Promise<ParsedQuestion> {
        const config = getAppConfig();
        const systemPrompt = generateSimilarQuestionPrompt(language, originalQuestion, knowledgePoints, difficulty, {
            customTemplate: config.prompts?.similar,
            originalFigureSvg,
        }, gradeSemester);
        const userPrompt = `
Original Question: "${originalQuestion}"
Knowledge Points: ${knowledgePoints.join(", ")}
        `;

        logger.box('🎯 Generate Similar Question Request', {
            provider: 'Azure OpenAI',
            endpoint: this.endpoint,
            model: this.model,
            deployment: this.deployment,
            originalQuestion: originalQuestion.substring(0, 100) + '...',
            knowledgePoints: knowledgePoints.join(', '),
            difficulty,
            language
        });
        logger.box('📝 System Prompt', systemPrompt);
        logger.box('📝 User Prompt', userPrompt);

        try {
            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    {
                        role: "system",
                        content: systemPrompt,
                    },
                    {
                        role: "user",
                        content: userPrompt,
                    },
                ],
                max_tokens: maxTokens,
            }), 8192, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            const text = response.choices[0]?.message?.content || "";

            logger.box('🤖 AI Raw Response', text);

            if (!text) throw new Error("Empty response from AI");
            const parsedResult = this.parseResponse(text);

            logger.box('✅ Parsed & Validated Result', JSON.stringify(parsedResult, null, 2));

            return normalizeGeneratedQuestion(parsedResult);

        } catch (error) {
            logger.box('❌ Error during similar question generation', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            this.handleError(error);
            throw error;
        }
    }

    async reanswerQuestion(
        questionText: string,
        language: 'zh' | 'en' = 'zh',
        subject?: string | null,
        imageBase64?: string,
        gradeSemester?: string | null,
        candidateTags?: CandidateTags
    ): Promise<ReanswerQuestionResult> {
        const prompt = generateReanswerPrompt(language, questionText, subject, { candidateTags }, gradeSemester);

        logger.box('🔄 Reanswer Question Request', {
            provider: 'Azure OpenAI',
            endpoint: this.endpoint,
            model: this.model,
            deployment: this.deployment,
            questionLength: questionText.length,
            subject: subject || 'auto',
            hasImage: !!imageBase64
        });
        logger.debug({ prompt }, 'Full prompt');

        try {
            // 根据是否有图片构建不同的消息内容
            let userContent: AzureUserContent = "请根据上述题目提供答案和解析。";
            if (imageBase64) {
                // 如果有图片，构建多模态消息
                const imageUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
                logger.debug({ imageLength: imageUrl.length }, 'Image added to request');
                userContent = [
                    { type: "text", text: "请结合图片和题目描述提供答案和解析。" },
                    { type: "image_url", image_url: { url: imageUrl } }
                ];
            } else {
                logger.debug({ imageBase64Type: typeof imageBase64, hasValue: !!imageBase64 }, 'No image data');
            }

            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: userContent }
                ],
                max_tokens: maxTokens,
            }), 8192, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            logger.debug({ response: JSON.stringify(response) }, 'Full API response');

            // 检查响应是否有效
            if (!response || !response.choices || response.choices.length === 0) {
                logger.error({ response: JSON.stringify(response) }, 'Invalid API response - no choices array');
                throw new Error("AI_RESPONSE_ERROR: API returned empty or invalid response");
            }

            const text = response.choices[0]?.message?.content || "";

            logger.debug({ rawResponse: text }, 'AI raw response');

            if (!text) throw new Error("Empty response from AI");

            // 解析响应
            const answerText = this.extractTag(text, "answer_text") || "";
            const analysis = this.extractTag(text, "analysis") || "";
            const knowledgePointsRaw = this.extractTag(text, "knowledge_points") || "";
            const knowledgePoints = knowledgePointsRaw.split(/[,，\n]/).map(k => k.trim()).filter(k => k.length > 0);
            const wrongAnswerText = this.extractTag(text, "wrong_answer_text") || "";
            const mistakeAnalysis = this.extractTag(text, "mistake_analysis") || "";
            const mistakeStatus = normalizeMistakeStatusForSave(
                this.extractTag(text, "mistake_status"),
                wrongAnswerText
            );

            logger.info('Reanswer parsed successfully');

            return { answerText, analysis, knowledgePoints, wrongAnswerText, mistakeAnalysis, mistakeStatus, subject: normalizeSubject(this.extractTag(text, "subject")), difficultyStars: parseDifficultyStars(this.extractTag(text, "difficulty_stars")) };

        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during reanswer');
            this.handleError(error);
            throw error;
        }
    }

    async analyzeForGeogebra(questionText: string, answerText: string, analysis: string, previousErrors?: string): Promise<GeogebraAnalysisResult> {
        const prompt = generateGeogebraPrompt(questionText, answerText, analysis, previousErrors);

        logger.info({
            provider: 'Azure OpenAI',
            model: this.model,
            deployment: this.deployment,
            questionLength: questionText.length,
        }, 'GeoGebra Analysis Request');

        try {
            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: "请分析上述题目并生成 GeoGebra 演示命令。" }
                ],
                max_tokens: maxTokens,
            }), 4096, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            const text = response.choices[0]?.message?.content || '';
            logger.debug({ rawResponse: text }, 'GeoGebra AI raw response');

            if (!text) throw new Error("Empty response from AI");

            // Extract JSON from response (handle possible markdown code blocks)
            let jsonStr = text.trim();
            const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1].trim();
            }

            // Try to find JSON object
            const objStart = jsonStr.indexOf('{');
            const objEnd = jsonStr.lastIndexOf('}');
            if (objStart !== -1 && objEnd !== -1) {
                jsonStr = jsonStr.substring(objStart, objEnd + 1);
            }

            const parsed = JSON.parse(jsonStr);

            return {
                suitable: Boolean(parsed.suitable),
                commands: Array.isArray(parsed.commands) ? parsed.commands : [],
                description: parsed.description || "",
            };
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during GeoGebra analysis');
            this.handleError(error);
            throw error;
        }
    }

    async evaluateMastery(input: MasteryEvaluationInput): Promise<MasteryEvaluationResult> {
        const prompt = generateMasteryPrompt(input);

        logger.info({
            provider: 'Azure OpenAI',
            historyCount: input.history.length,
        }, 'Mastery Evaluation Request');

        try {
            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: "请根据上述练习历史给出掌握概率评估。" }
                ],
                max_tokens: maxTokens,
            }), 4096, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            const text = response.choices[0]?.message?.content || '';
            logger.debug({ rawResponse: text }, 'Mastery AI raw response');

            if (!text) throw new Error("Empty response from AI");
            return parseMasteryEvaluation(text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during mastery evaluation');
            this.handleError(error);
            throw error;
        }
    }

    async gradeAnswer(input: AnswerGradingInput): Promise<AnswerGradingResult> {
        logger.info({ provider: 'Azure OpenAI' }, 'Answer Grading Request');

        try {
            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    { role: "system", content: generateGradingPrompt(input) },
                    { role: "user", content: "请判定学生答案是否正确。" }
                ],
                max_tokens: maxTokens,
            }), 4096, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            const text = response.choices[0]?.message?.content || '';
            logger.debug({ rawResponse: text }, 'Grading AI raw response');

            if (!text) throw new Error("Empty response from AI");
            return parseAnswerGrading(text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during answer grading');
            this.handleError(error);
            throw error;
        }
    }

    async suggestKnowledgeTags(input: TagSuggestionInput): Promise<TagSuggestionResult> {
        const prompt = generateTagSuggestPrompt(input);

        logger.info({
            provider: 'Azure OpenAI',
            subject: input.subject,
            allowedTagCount: input.allowedTags.length,
        }, 'Tag Suggestion Request');

        try {
            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: "请为上述题目选择知识点。" }
                ],
                max_tokens: maxTokens,
            }), 4096, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            const text = response.choices[0]?.message?.content || '';
            logger.debug({ rawResponse: text }, 'Tag suggestion AI raw response');

            if (!text) throw new Error("Empty response from AI");
            return parseTagSuggestion(text, input.allowedTags);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during tag suggestion');
            this.handleError(error);
            throw error;
        }
    }

    async generateFigureSvg(imageBase64: string, mimeType: string, questionText?: string | null): Promise<FigureResult> {
        const prompt = generateFigurePrompt(questionText);
        logger.info({ provider: 'Azure OpenAI', deployment: this.deployment, imageSize: imageBase64.length }, 'Figure SVG Request');

        try {
            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: [{ type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }] },
                ],
                max_tokens: maxTokens,
            }), 8192, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            const text = response.choices[0]?.message?.content || '';
            logger.debug({ rawResponse: text }, 'Figure SVG AI raw response');

            if (!text) throw new Error("Empty response from AI");
            return parseFigure(this.extractTag(text, "has_figure"), this.extractTag(text, "figure_svg"));
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during figure SVG generation');
            this.handleError(error);
            throw error;
        }
    }

    async fixLatex(input: LatexFixInput): Promise<LatexFixResult> {
        const prompt = generateLatexFixPrompt(input);
        logger.info({ provider: 'Azure OpenAI', deployment: this.deployment, fields: Object.keys(input) }, 'LaTeX Fix Request');

        try {
            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: "请修复上述内容中的 LaTeX 语法。" },
                ],
                max_tokens: maxTokens,
            }), 8192, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            const text = response.choices[0]?.message?.content || '';
            logger.debug({ rawResponse: text }, 'LaTeX fix AI raw response');

            if (!text) throw new Error("Empty response from AI");
            return parseLatexFix(text, input);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during LaTeX fix');
            this.handleError(error);
            throw error;
        }
    }

    async generateSvgAnimation(questionText: string, answerText: string, analysis: string, figureSvg?: string | null, language: 'zh' | 'en' = 'zh'): Promise<string | null> {
        const prompt = generateSvgAnimationPrompt(questionText, answerText, analysis, figureSvg, language);
        logger.info({ provider: 'Azure OpenAI', deployment: this.deployment, questionLength: questionText.length }, 'SVG Animation Request');

        try {
            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: SVG_ANIMATION_REQUEST[language] },
                ],
                max_tokens: maxTokens,
            }), 16384, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            const text = response.choices[0]?.message?.content || '';
            logger.debug({ rawResponse: text }, 'SVG animation AI raw response');

            if (!text) throw new Error("Empty response from AI");
            return sanitizeSvgAnimation(this.extractTag(text, "svg_animation") || text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during SVG animation generation');
            this.handleError(error);
            throw error;
        }
    }

    async generateSvgNarration(questionText: string, answerText: string, analysis: string, svgAnimation: string, language: 'zh' | 'en' = 'zh'): Promise<NarrationSegment[] | null> {
        const prompt = generateSvgNarrationPrompt(questionText, answerText, analysis, svgAnimation, language);
        logger.info({ provider: 'Azure OpenAI', deployment: this.deployment, svgLength: svgAnimation.length }, 'SVG Narration Request');

        try {
            const response = await withTruncationRetry((maxTokens) => this.client.chat.completions.create({
                model: this.deployment,
                messages: [
                    { role: "system", content: prompt },
                    { role: "user", content: SVG_NARRATION_REQUEST[language] },
                ],
                max_tokens: maxTokens,
            }), 4096, () => logger.warn('Output truncated by reasoning, retrying with larger max_tokens'));

            const text = response.choices[0]?.message?.content || '';
            logger.debug({ rawResponse: text }, 'SVG narration AI raw response');

            if (!text) throw new Error("Empty response from AI");
            return parseNarration(this.extractTag(text, "narration") || text);
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during SVG narration generation');
            this.handleError(error);
            throw error;
        }
    }

    private handleError(error: unknown) {
        logger.error({ error }, 'Azure OpenAI error');
        if (error instanceof Error) {
            if (error.message === AI_OUTPUT_TRUNCATED || error.message.startsWith('AI_RESPONSE_ERROR:')) {
                throw error;
            }
            const msg = error.message.toLowerCase();
            if (msg.includes('fetch failed') || msg.includes('network') || msg.includes('connect')) {
                throw new Error("AI_CONNECTION_FAILED");
            }
            // 超时错误 (包括 408 Request Timeout)
            if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted') || msg.includes('408')) {
                throw new Error("AI_TIMEOUT_ERROR");
            }
            // 配额/频率限制错误
            if (msg.includes('quota') || msg.includes('额度') || msg.includes('rate limit') || msg.includes('429') || msg.includes('too many')) {
                throw new Error("AI_QUOTA_EXCEEDED");
            }
            // 权限/403 错误
            if (msg.includes('403') || msg.includes('forbidden') || msg.includes('permission')) {
                throw new Error("AI_PERMISSION_DENIED");
            }
            // 资源不存在/404 错误
            if (msg.includes('404') || msg.includes('not found') || msg.includes('does not exist')) {
                throw new Error("AI_NOT_FOUND");
            }
            // 服务器错误 (500/502/503/504)
            if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') ||
                msg.includes('无可用') || msg.includes('overloaded') || msg.includes('unavailable')) {
                throw new Error("AI_SERVICE_UNAVAILABLE");
            }
            if (msg.includes('invalid json') || msg.includes('parse')) {
                throw new Error("AI_RESPONSE_ERROR");
            }
            if (msg.includes('api key') || msg.includes('unauthorized') || msg.includes('401')) {
                throw new Error("AI_AUTH_ERROR");
            }
        }
        throw new Error("AI_UNKNOWN_ERROR");
    }
}

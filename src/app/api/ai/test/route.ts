import { NextResponse } from 'next/server';
import { OpenAIProvider, DEFAULT_OPENAI_MODEL } from '@/lib/ai/openai-provider';
import { GeminiProvider } from '@/lib/ai/gemini-provider';
import { AzureOpenAIProvider } from '@/lib/ai/azure-provider';
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from '@/lib/ai/anthropic-provider';
import { MiniMaxCodeProvider } from '@/lib/ai/minimax-code-provider';
import { DEFAULT_MINIMAX_CODE_MODEL } from '@/lib/minimax-code/constants';
import { isVendorProvider, resolveVendorConfig } from '@/lib/ai/vendor-presets';
import { withAdmin } from '@/lib/api-handler';
import { aiTestBodySchema } from '@/lib/schemas/ai';
import type { AITestResponse } from '@/lib/ai/connection-test';
import { parseErrorCode } from '@/lib/ai/error-classification';
import { createLogger } from '@/lib/logger';
import { getErrorDetail } from '@/lib/error-message';

const logger = createLogger('api:ai:test');

// 测试用图片：简单的数学题 "2 + 3 = ?"（约 1.7KB）
const TEST_IMAGE_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABkAMgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2aiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACobu5js7SW5lDFIkLsEXJIA6AdzU1QXpuxZTfYVha62HyhOxCbu24gE4+lAEOm6kmorPiCa3ltpfKmhm27kbarfwkg5VlPBPWrAuYXgeaOQSohYMY/n5UkMOO4IIx1yMVQ0XT57XS3tr1EWaRmaWSK4Z2lZurltqkEnPAHAAx04ZpegnR9MurW0vJjNPJNIksrvIIy7u6/KzHpu5P8WMnk0ATabrEeozz25tbi1ngRJGinC7tr52n5WOM7W4OCMcjpVy5uEtbWW5k3bIULttUscAZOAOprL0fS7m2vL+7uobS2a9Cb4bUlkLjdukJKj5m3AHjog5NS6NoNtonnfZ33edt3fuIY+mf+eaLnr3z7d6AJ9N1NNSSbEE1vLby+VLDMF3I21WH3SR91lPB71dqpYWYtEmyoDzTySud27dluOcD+EKMdsYycZNugAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/2Q==';
const TEST_IMAGE_MIME = 'image/jpeg';


async function handlePost(request: Request) {
    try {
        const parsed = aiTestBodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json({ error: 'Missing provider or apiKey' }, { status: 400 });
        }
        const { provider, apiKey, baseUrl, model, endpoint, deploymentName, apiVersion, language = 'zh' } = parsed.data;

        if (!apiKey && provider !== 'minimax-code') {
            return NextResponse.json({ error: 'Missing provider or apiKey' }, { status: 400 });
        }

        logger.info({ provider, model, baseUrl: baseUrl || endpoint }, 'AI 连接测试开始');

        let textSupport = false;
        let visionSupport = false;
        let textError: string | undefined;
        let visionError: string | undefined;
        let textErrorDetail: string | undefined;
        let visionErrorDetail: string | undefined;
        let modelInfo: string | undefined;

        // 辅助函数：判断错误是否为配置/连接问题（不应继续文本测试）
        const isConfigError = (errorCode: string) => {
            return ['AI_AUTH_ERROR', 'AI_CONNECTION_FAILED', 'AI_TIMEOUT_ERROR',
                'AI_QUOTA_EXCEEDED', 'AI_PERMISSION_DENIED', 'AI_SERVICE_UNAVAILABLE'].includes(errorCode);
        };

        // 优化策略：先视觉测试，成功则一步完成；失败则根据错误类型决定是否进行文本测试
        // 测试 1: 视觉（多模态）能力
        try {
            if (provider === 'openai') {
                const openai = new OpenAIProvider({ apiKey, baseUrl, model });
                const result = await openai.analyzeImage(TEST_IMAGE_BASE64, TEST_IMAGE_MIME, language);
                if (result.questionText || result.analysis) {
                    // 视觉成功 → 文本和视觉都支持，一步完成
                    textSupport = true;
                    visionSupport = true;
                    modelInfo = model || DEFAULT_OPENAI_MODEL;
                }
            } else if (provider === 'gemini') {
                const gemini = new GeminiProvider({ apiKey, baseUrl, model });
                const result = await gemini.analyzeImage(TEST_IMAGE_BASE64, TEST_IMAGE_MIME, language);
                if (result.questionText || result.analysis) {
                    textSupport = true;
                    visionSupport = true;
                    modelInfo = model || 'gemini-2.0-flash';
                }
            } else if (provider === 'anthropic') {
                const anthropic = new AnthropicProvider({ apiKey, baseUrl, model });
                const result = await anthropic.analyzeImage(TEST_IMAGE_BASE64, TEST_IMAGE_MIME, language);
                if (result.questionText || result.analysis) {
                    textSupport = true;
                    visionSupport = true;
                    modelInfo = model || DEFAULT_ANTHROPIC_MODEL;
                }
            } else if (provider === 'minimax-code') {
                const result = await new MiniMaxCodeProvider({ model }).analyzeImage(TEST_IMAGE_BASE64, TEST_IMAGE_MIME, language);
                if (result.questionText || result.analysis) {
                    textSupport = true;
                    visionSupport = true;
                    modelInfo = model || DEFAULT_MINIMAX_CODE_MODEL;
                }
            } else if (isVendorProvider(provider)) {
                const vendorConfig = resolveVendorConfig(provider, { apiKey, baseUrl, model });
                const result = await new OpenAIProvider(vendorConfig).analyzeImage(TEST_IMAGE_BASE64, TEST_IMAGE_MIME, language);
                if (result.questionText || result.analysis) {
                    textSupport = true;
                    visionSupport = true;
                    modelInfo = vendorConfig.model;
                }
            } else if (provider === 'azure') {
                if (!endpoint || !deploymentName) {
                    return NextResponse.json({ error: 'Azure 需要 endpoint 和 deploymentName' }, { status: 400 });
                }
                const azure = new AzureOpenAIProvider({
                    apiKey,
                    endpoint,
                    deploymentName,
                    apiVersion,
                    model
                });
                const result = await azure.analyzeImage(TEST_IMAGE_BASE64, TEST_IMAGE_MIME, language);
                if (result.questionText || result.analysis) {
                    textSupport = true;
                    visionSupport = true;
                    modelInfo = model || deploymentName;
                }
            }
        } catch (error) {
            const errCode = parseErrorCode(error);
            const errMsg = error instanceof Error ? error.message : String(error);
            visionErrorDetail = getErrorDetail(error);

            logger.info({ error: errMsg, errorCode: errCode, provider }, '视觉测试失败');

            // 如果是配置/连接问题，直接返回错误，不再测试文本
            if (isConfigError(errCode)) {
                textError = errCode;
                visionError = errCode;
                textErrorDetail = visionErrorDetail;
                logger.warn({ errorCode: errCode, provider }, '配置错误，跳过文本测试');
            } else {
                // 非配置错误（如模型不支持多模态），标记为视觉不支持
                visionError = 'VISION_NOT_SUPPORTED';
            }
        }

        // 测试 2: 文本生成能力（仅在视觉失败且非配置错误时进行）
        if (!textSupport && !textError) {
            try {
                if (provider === 'openai') {
                    const openai = new OpenAIProvider({ apiKey, baseUrl, model });
                    const result = await openai.generateSimilarQuestion(
                        '1+1=?',
                        ['基础算术'],
                        language,
                        'easy'
                    );
                    if (result.questionText) {
                        textSupport = true;
                        modelInfo = model || DEFAULT_OPENAI_MODEL;
                    }
                } else if (provider === 'gemini') {
                    const gemini = new GeminiProvider({ apiKey, baseUrl, model });
                    const result = await gemini.generateSimilarQuestion(
                        '1+1=?',
                        ['基础算术'],
                        language,
                        'easy'
                    );
                    if (result.questionText) {
                        textSupport = true;
                        modelInfo = model || 'gemini-2.0-flash';
                    }
                } else if (provider === 'anthropic') {
                    const anthropic = new AnthropicProvider({ apiKey, baseUrl, model });
                    const result = await anthropic.generateSimilarQuestion('1+1=?', ['基础算术'], language, 'easy');
                    if (result.questionText) {
                        textSupport = true;
                        modelInfo = model || DEFAULT_ANTHROPIC_MODEL;
                    }
                } else if (provider === 'minimax-code') {
                    const result = await new MiniMaxCodeProvider({ model }).generateSimilarQuestion('1+1=?', ['基础算术'], language, 'easy');
                    if (result.questionText) {
                        textSupport = true;
                        modelInfo = model || DEFAULT_MINIMAX_CODE_MODEL;
                    }
                } else if (isVendorProvider(provider)) {
                    const vendorConfig = resolveVendorConfig(provider, { apiKey, baseUrl, model });
                    const result = await new OpenAIProvider(vendorConfig).generateSimilarQuestion('1+1=?', ['基础算术'], language, 'easy');
                    if (result.questionText) {
                        textSupport = true;
                        modelInfo = vendorConfig.model;
                    }
                } else if (provider === 'azure') {
                    const azure = new AzureOpenAIProvider({
                        apiKey,
                        endpoint,
                        deploymentName,
                        apiVersion,
                        model
                    });
                    const result = await azure.generateSimilarQuestion(
                        '1+1=?',
                        ['基础算术'],
                        language,
                        'easy'
                    );
                    if (result.questionText) {
                        textSupport = true;
                        modelInfo = model || deploymentName;
                    }
                }
            } catch (error) {
                textError = parseErrorCode(error);
                textErrorDetail = getErrorDetail(error);
                logger.warn({ error, provider }, '文本生成测试失败');
            }
        }

        const response: AITestResponse = {
            success: textSupport,
            textSupport,
            visionSupport,
            textError,
            visionError,
            textErrorDetail,
            visionErrorDetail,
            modelInfo
        };

        logger.info({ response }, 'AI 连接测试完成');

        return NextResponse.json(response);

    } catch (error) {
        logger.error({ error }, 'AI 测试 API 异常');
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

export const POST = withAdmin(handlePost);

import { createLogger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-message';

const logger = createLogger('lib:openclaw:agent-client');

export interface OpenclawRecognizedData {
    questionText: string;
    answerText: string;
    analysis: string;
    wrongAnswerText?: string;
    mistakeAnalysis?: string;
    knowledgePoints: string[];
    subject?: string;
    errorType?: string;
    source?: string;
    difficultyStars?: number | null;
    gradeSemester?: string | null;
}

export interface OpenclawResponse {
    success: boolean;
    data?: OpenclawRecognizedData;
    error?: string;
}

/**
 * 调用外部 Openclaw 智能体识别单张题目图片。
 */
export async function callOpenclawAgent(imageBase64: string, mimeType: string, timeout: number): Promise<OpenclawResponse> {
    const openclawUrl = process.env.OPENCLAW_API_URL || 'http://localhost:8080';
    const openclawApiKey = process.env.OPENCLAW_API_KEY || '';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(`${openclawUrl}/api/recognize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(openclawApiKey ? { 'Authorization': `Bearer ${openclawApiKey}` } : {}),
            },
            body: JSON.stringify({
                image: imageBase64,
                mimeType: mimeType,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            logger.error({ status: response.status, error: errorText }, 'Openclaw agent error');
            return {
                success: false,
                error: `识别服务异常: HTTP ${response.status}`,
            };
        }

        const data = await response.json() as OpenclawResponse;
        return data;
    } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
            logger.error('Openclaw agent timeout');
            return {
                success: false,
                error: '识别服务超时',
            };
        }

        logger.error({ error: getErrorMessage(error) }, 'Openclaw agent request failed');
        return {
            success: false,
            error: `识别服务请求失败: ${getErrorMessage(error)}`,
        };
    }
}

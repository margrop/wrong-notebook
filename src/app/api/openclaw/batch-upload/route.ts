import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { startBackgroundTask } from "@/lib/background-tasks";
import type { BackgroundTaskHandle } from "@/lib/background-tasks";
import { badRequest, createErrorResponse, ErrorCode, tooManyRequests } from "@/lib/api-errors";
import { importSchema, saveQuestion } from "@/lib/question/question-save";
import { parseDifficultyStars } from "@/lib/ai/schema";
import { isAiRejectionCode } from "@/lib/ai-limit-message";
import { getErrorMessage } from "@/lib/error-message";
import { MAX_IMAGE_BASE64_LENGTH, validateImage } from "@/lib/openclaw/image-validation";
import { callOpenclawAgent } from "@/lib/openclaw/agent-client";
import type { OpenclawRecognizedData } from "@/lib/openclaw/agent-client";
import { getClientIp, openclawIpLimiter } from "@/lib/rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/request-body";

const logger = createLogger('api:openclaw:batch-upload');

const MAX_IMAGES = 20;
const MAX_REQUEST_BODY_BYTES = 128 * 1024 * 1024;

const imageSchema = z.object({
    base64: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH),
    mimeType: z.string().trim().max(100),
    filename: z.string().trim().min(1).max(255),
});

const requestSchema = z.object({
    username: z.string().trim().max(320).optional(),
    password: z.string().max(500).optional(),
    userEmail: z.string().trim().max(320).optional(),
    subjectId: z.string().trim().max(100).optional(),
    images: z.array(imageSchema).min(1).max(MAX_IMAGES),
});

const authRequestSchema = z.object({
    username: z.string().trim().max(320).optional(),
    password: z.string().max(500).optional(),
    userEmail: z.string().trim().max(320).optional(),
    subjectId: z.string().trim().max(100).optional(),
});

interface ImageData {
    base64: string;
    mimeType: string;
    filename: string;
}

export async function POST(req: Request) {
    logger.info('POST /api/openclaw/batch-upload called');

    const clientIp = getClientIp(req.headers);
    if (clientIp) {
        const retryAfter = openclawIpLimiter.retryAfter(clientIp);
        if (retryAfter > 0) return tooManyRequests(retryAfter);
        openclawIpLimiter.hit(clientIp);
    }

    // 获取请求头中的 API Key
    const apiKey = req.headers.get('x-api-key');
    // 从环境变量获取配置的 API Key
    const expectedApiKey = process.env.OPENCLAW_INTEGRATION_API_KEY;
    // 认证模式：credentials（用户名密码，默认）或 apikey（API Key）
    const authMode = process.env.OPENCLAW_AUTH_MODE || 'credentials';

    let user = null;
    let userEmail = null;
    let subjectId = null;
    let task: BackgroundTaskHandle | null = null;

    try {
        let rawBody: unknown;
        try {
            rawBody = await readJsonBody(req, MAX_REQUEST_BODY_BYTES);
        } catch (error) {
            if (error instanceof RequestBodyTooLargeError) return badRequest('OPENCLAW_REQUEST_TOO_LARGE');
            throw error;
        }
        const parsedAuthRequest = authRequestSchema.safeParse(rawBody);
        if (!parsedAuthRequest.success) return badRequest('OPENCLAW_INVALID_REQUEST', parsedAuthRequest.error.issues);
        const authRequestData = parsedAuthRequest.data;

        // 根据认证模式选择验证方式
        if (authMode === 'apikey' && expectedApiKey) {
            // API Key 认证模式
            if (!apiKey) {
                logger.warn('Missing API key in request');
                return createErrorResponse(
                    '未提供API密钥',
                    401,
                    ErrorCode.UNAUTHORIZED,
                    'Missing API key'
                );
            }

            const candidate = Buffer.from(apiKey);
            const expected = Buffer.from(expectedApiKey);
            if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
                logger.warn('Invalid API key provided');
                return createErrorResponse(
                    'API密钥无效',
                    401,
                    ErrorCode.UNAUTHORIZED,
                    'Invalid API key'
                );
            }

            userEmail = authRequestData.userEmail;
            subjectId = authRequestData.subjectId;
            if (!userEmail) return badRequest('OPENCLAW_USER_REQUIRED');
        } else {
            // 用户名密码认证模式（默认）
            const { username, password } = authRequestData;

            if (!username || !password) {
                return createErrorResponse(
                    '请提供用户名和密码',
                    401,
                    ErrorCode.UNAUTHORIZED,
                    'Missing username or password'
                );
            }

            // 从数据库查找用户（支持邮箱或用户名登录）
            user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { email: username },
                        { name: username }
                    ],
                    isActive: true,
                }
            });

            if (!user) {
                logger.warn({ username }, 'User not found');
                return createErrorResponse(
                    '用户不存在',
                    404,
                    ErrorCode.USER_NOT_FOUND,
                    'User not found'
                );
            }

            // 验证密码（使用 bcrypt 比对）
            const isPasswordValid = await compare(password, user.password);
            if (!isPasswordValid) {
                logger.warn({ username }, 'Invalid password');
                return createErrorResponse(
                    '密码错误',
                    401,
                    ErrorCode.UNAUTHORIZED,
                    'Invalid password'
                );
            }

            userEmail = user.email;
            subjectId = authRequestData.subjectId;
            logger.info({ userId: user.id, email: user.email }, 'User authenticated via credentials');
        }

        const parsedRequest = requestSchema.safeParse(rawBody);
        if (!parsedRequest.success) return badRequest('OPENCLAW_INVALID_REQUEST', parsedRequest.error.issues);
        const requestData = parsedRequest.data;

        // 获取图片数组
        const { images } = requestData;

        // 验证图片数组
        if (!images || !Array.isArray(images) || images.length === 0) {
            return createErrorResponse(
                '未提供图片数据',
                400,
                ErrorCode.BAD_REQUEST,
                'Missing images array'
            );
        }

        // 验证图片数量
        if (images.length > MAX_IMAGES) {
            return createErrorResponse(
                `图片数量超过限制: 最多${MAX_IMAGES}张`,
                400,
                ErrorCode.BAD_REQUEST,
                `Maximum ${MAX_IMAGES} images allowed`
            );
        }

        // 获取用户信息（API Key模式需要单独查询）
        let dbUser = user;
        if (!dbUser) {
            dbUser = await prisma.user.findUnique({
                where: { email: userEmail, isActive: true },
            });
        }

        if (!dbUser) {
            logger.warn({ userEmail }, 'User not found');
            return createErrorResponse(
                '用户不存在',
                404,
                ErrorCode.USER_NOT_FOUND,
                'User not found'
            );
        }

        const timeout = parseInt(process.env.OPENCLAW_TIMEOUT || '30000', 10);
        const singleImageTimeout = Math.min(3000, timeout / images.length);
        const results: Array<{
            success: boolean;
            index: number;
            errorItemId?: string;
            duplicate?: boolean;
            mistakeRecorded?: boolean;
            similarity?: number;
            practiceRecordId?: string;
            message?: string;
            error?: string;
        }> = [];
        // 页面「后台任务」中显示识别进度
        const currentTask = startBackgroundTask({ userId: dbUser.id, kind: 'batch_upload', total: images.length });
        task = currentTask;
        const reportProgress = () => currentTask.setProgress(results.length, images.length, results.filter(r => !r.success).length);

        for (let i = 0; i < images.length; i++) {
            reportProgress();
            const imageData = images[i] as ImageData;
            const { base64, mimeType, filename } = imageData;

            const validation = validateImage(base64, filename, mimeType);
            if (!validation.valid) {
                logger.warn({ index: i, filename, error: validation.error }, 'Image validation failed');
                results.push({
                    success: false,
                    index: i,
                    error: validation.error,
                });
                continue;
            }

            const openclawResponse = await callOpenclawAgent(base64, mimeType, singleImageTimeout);

            if (!openclawResponse.success || !openclawResponse.data) {
                logger.error({ index: i, error: openclawResponse.error }, 'Openclaw recognition failed');
                results.push({
                    success: false,
                    index: i,
                    error: openclawResponse.error || '识别失败',
                });
                continue;
            }

            try {
                const parsed: OpenclawRecognizedData = openclawResponse.data;
                const payload = importSchema.safeParse({
                    questionText: parsed.questionText,
                    answerText: parsed.answerText,
                    analysis: parsed.analysis,
                    wrongAnswerText: parsed.wrongAnswerText || null,
                    mistakeAnalysis: parsed.mistakeAnalysis || null,
                    knowledgePoints: Array.isArray(parsed.knowledgePoints) ? parsed.knowledgePoints : [],
                    difficultyStars: parseDifficultyStars(parsed.difficultyStars),
                    recognizedGradeSemester: parsed.gradeSemester ?? undefined,
                    originalImageUrl: `data:${mimeType};base64,${base64}`,
                    subjectId: subjectId || undefined,
                });

                if (!payload.success) {
                    results.push({ success: false, index: i, error: `导入失败: 题目数据不合法` });
                    continue;
                }

                const saveResult = await saveQuestion(dbUser, payload.data, {
                    origin: 'openclaw',
                    extraErrorItemData: {
                        ocrText: parsed.questionText || null,
                        errorType: parsed.errorType || null,
                        source: parsed.source || 'Openclaw',
                    },
                });

                if (!saveResult.ok) {
                    results.push({
                        success: false,
                        index: i,
                        error: isAiRejectionCode(saveResult.error.code) ? saveResult.error.code : `导入失败: ${saveResult.error.code}`,
                    });
                    continue;
                }

                const errorItem = saveResult.item;

                results.push({
                    success: true,
                    index: i,
                    errorItemId: errorItem.id,
                    ...('duplicate' in errorItem ? {
                        duplicate: errorItem.duplicate,
                        mistakeRecorded: errorItem.mistakeRecorded,
                        similarity: errorItem.similarity,
                        practiceRecordId: errorItem.practiceRecordId,
                        message: errorItem.message,
                    } : {}),
                });

                logger.info({ index: i, errorItemId: errorItem.id }, 'Error item created successfully');
            } catch (dbError) {
                logger.error({ index: i, error: getErrorMessage(dbError) }, 'Failed to create error item');
                results.push({
                    success: false,
                    index: i,
                    error: `导入失败: ${getErrorMessage(dbError)}`,
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;
        reportProgress();
        if (successCount === 0) currentTask.fail('ALL_FAILED');
        else currentTask.succeed();

        logger.info({
            total: results.length,
            success: successCount,
            failed: failCount
        }, 'Batch upload completed');

        const statusCode = failCount === 0 ? 201 : 207;

        return NextResponse.json({
            success: failCount === 0,
            total: results.length,
            successCount,
            failCount,
            results,
        }, { status: statusCode });
    } catch (error) {
        task?.fail(error);
        const message = getErrorMessage(error);
        logger.error({ error: message, stack: error instanceof Error ? error.stack : undefined }, 'Batch upload error');
        return createErrorResponse(
            message || '批量上传失败',
            500,
            ErrorCode.INTERNAL_ERROR,
            message
        );
    }
}

import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { startBackgroundTask } from "@/lib/background-tasks";
import type { BackgroundTaskHandle } from "@/lib/background-tasks";
import { createErrorResponse, ErrorCode } from "@/lib/api-errors";
import { calculateGrade } from "@/lib/grade-calculator";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { findParentTagIdForGrade } from "@/lib/tag-recognition";
import { generateUniqueShortId } from "@/lib/short-id";
import { scheduleMasteryEvaluation } from "@/lib/mastery";
import { findDuplicateQuestion, recordDuplicateQuestion, runQuestionImportTransaction } from "@/lib/question-deduplication";
import { parseDifficultyStars } from "@/lib/ai/schema";
import { getDefaultPaperLevel } from "@/lib/paper-level";
import { getAppTimeZone } from "@/lib/config";
import { getErrorMessage } from "@/lib/error-message";

const logger = createLogger('api:openclaw:batch-upload');

const MAX_IMAGES = 20;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

interface ImageData {
    base64: string;
    mimeType: string;
    filename: string;
}

interface OpenclawResponse {
    success: boolean;
    data?: {
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
    };
    error?: string;
}

function validateImage(base64: string, filename: string, mimeType: string): { valid: boolean; error?: string } {
    if (!base64 || base64.length === 0) {
        return { valid: false, error: '图片数据为空' };
    }

    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        return { valid: false, error: `不支持的图片格式: ${extension}，仅支持 JPG、PNG` };
    }

    // mimeType 会写入题目原图的 data URL，须与扩展名一样限定为 JPG、PNG
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        return { valid: false, error: `不支持的图片类型: ${String(mimeType).slice(0, 50)}，仅支持 image/jpeg、image/png` };
    }

    const estimatedSize = (base64.length * 3) / 4;
    if (estimatedSize > MAX_IMAGE_SIZE) {
        return { valid: false, error: `图片大小超过限制: ${Math.round(estimatedSize / 1024 / 1024)}MB > 5MB` };
    }

    return { valid: true };
}

async function callOpenclawAgent(imageBase64: string, mimeType: string, timeout: number): Promise<OpenclawResponse> {
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

async function createErrorItem(
    userId: string,
    imageBase64: string,
    mimeType: string,
    parsedData: OpenclawResponse['data'],
    subjectId?: string
) {
    const { questionText, answerText, analysis, knowledgePoints, errorType, source } = parsedData || {};
    const difficultyStars = parseDifficultyStars(parsedData?.difficultyStars);

    const content = {
        questionText,
        answerText,
        analysis,
        wrongAnswerText: parsedData?.wrongAnswerText,
        mistakeAnalysis: parsedData?.mistakeAnalysis,
        originalImageUrl: `data:${mimeType};base64,${imageBase64}`,
    };
    const result = await runQuestionImportTransaction(async (tx) => {
        const duplicate = await findDuplicateQuestion(tx, userId, content);
        if (duplicate) return recordDuplicateQuestion(tx, userId, duplicate, content);

        const tagNames: string[] = Array.isArray(knowledgePoints) ? knowledgePoints : [];
        const tagConnections: { id: string }[] = [];

        const subject = subjectId ? await tx.subject.findUnique({ where: { id: subjectId } }) : null;
        const subjectKey = subject ? inferSubjectFromName(subject.name) : null;

        const user = await tx.user.findUnique({
            where: { id: userId },
            select: { educationStage: true, enrollmentYear: true }
        });

        let finalGradeSemester: string | null = null;
        if (user?.educationStage && user?.enrollmentYear) {
            finalGradeSemester = calculateGrade(user.educationStage, user.enrollmentYear, new Date(), 'zh', getAppTimeZone());
        }

        for (const tagName of tagNames) {
            try {
                let tag = await tx.knowledgeTag.findFirst({
                    where: {
                        name: tagName,
                        OR: [
                            { isSystem: true },
                            { userId: userId },
                        ],
                    },
                });

                if (!tag) {
                    const parentId = finalGradeSemester && subjectKey
                        ? await findParentTagIdForGrade(finalGradeSemester, subjectKey, tx)
                        : null;

                    tag = await tx.knowledgeTag.create({
                        data: {
                            name: tagName,
                            subject: subjectKey || 'other',
                            isSystem: false,
                            userId: userId,
                            parentId: parentId || undefined,
                        },
                    });
                }

                tagConnections.push({ id: tag.id });
            } catch (tagError) {
                logger.error({ tagName, error: tagError }, 'Error processing tag');
            }
        }

        const errorItem = await tx.errorItem.create({
            data: {
                shortId: await generateUniqueShortId(tx),
                userId: userId,
                subjectId: subjectId || undefined,
                originalImageUrl: `data:${mimeType};base64,${imageBase64}`,
                ocrText: questionText || null,
                questionText: questionText || null,
                answerText: answerText || null,
                analysis: analysis || null,
                knowledgePoints: JSON.stringify(tagNames),
                gradeSemester: finalGradeSemester,
                paperLevel: getDefaultPaperLevel(difficultyStars),
                difficultyStars,
                errorType: errorType || null,
                source: source || 'Openclaw',
                masteryLevel: 0,
                tags: {
                    connect: tagConnections,
                },
            },
            include: {
                tags: true,
                subject: true,
            },
        });

        return errorItem;
    });
    if ('duplicate' in result && result.duplicate) scheduleMasteryEvaluation([result.id]);
    return result;
}

export async function POST(req: Request) {
    logger.info('POST /api/openclaw/batch-upload called');

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
        const body = await req.json();
        const requestData = body;

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

            if (apiKey !== expectedApiKey) {
                logger.warn('Invalid API key provided');
                return createErrorResponse(
                    'API密钥无效',
                    401,
                    ErrorCode.UNAUTHORIZED,
                    'Invalid API key'
                );
            }

            userEmail = requestData.userEmail;
            subjectId = requestData.subjectId;
        } else {
            // 用户名密码认证模式（默认）
            const { username, password } = requestData;

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
                    ]
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
            subjectId = requestData.subjectId;
            logger.info({ userId: user.id, email: user.email }, 'User authenticated via credentials');
        }

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
                where: { email: userEmail },
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
                const errorItem = await createErrorItem(
                    dbUser.id,
                    base64,
                    mimeType,
                    openclawResponse.data,
                    subjectId
                );

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
                    error: `数据库写入失败: ${getErrorMessage(dbError)}`,
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

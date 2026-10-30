/**
 * 云端语音接口的请求校验与错误响应（单段合成、整段动画批量合成共用）
 */
import { z } from "zod";
import { isAdmin } from "@/lib/auth-utils";
import { badRequest, createErrorResponse, ErrorCode } from "@/lib/api-errors";
import { getErrorDetail } from "@/lib/error-message";
import { createLogger } from "@/lib/logger";
import { MAX_NARRATION_SEGMENTS, MAX_NARRATION_TEXT_LENGTH } from "@/lib/svg-animation";
import { TtsError } from "./providers";

const logger = createLogger('api:tts');

export const speechTextSchema = z.string().trim().min(1).max(MAX_NARRATION_TEXT_LENGTH);
export const speechLanguageSchema = z.enum(['zh', 'en']).default('zh');

/** 一个动画的全部讲解段落 */
export const speechTextsSchema = z.array(speechTextSchema).min(1).max(MAX_NARRATION_SEGMENTS);

/** 合成失败的响应：未配置 Key 为 400；服务商报错为 502，原始报错只给管理员 */
export function speechErrorResponse(error: unknown, user: { role?: string } | null) {
    if (error instanceof TtsError && error.code === 'TTS_NOT_CONFIGURED') {
        return badRequest("TTS_NOT_CONFIGURED");
    }
    const detail = getErrorDetail(error);
    logger.error({ error: detail }, 'Speech synthesis failed');
    return createErrorResponse("TTS_PROVIDER_ERROR", 502, ErrorCode.AI_ERROR, isAdmin(user) ? detail : undefined);
}

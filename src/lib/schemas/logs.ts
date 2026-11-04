import { z } from 'zod';

/** 可选字符串字段：类型不对时按缺省处理，不拒绝整条日志 */
const optionalText = z.string().optional().catch(undefined);

/**
 * 前端日志单条 entry 的 zod 校验。日志接口宽进：除对象本身外字段均可缺省，
 * level 非法时按 info 记录，context 不是对象时忽略，message 统一转为字符串。
 */
const frontendLogEntrySchema = z.object({
    level: z.enum(['info', 'warn', 'error']).catch('info'),
    prefix: optionalText,
    message: z.unknown().transform((value) => String(value ?? '')),
    context: z.record(z.string(), z.unknown()).optional().catch(undefined),
    timestamp: optionalText,
    url: optionalText,
    userAgent: optionalText,
});

export type FrontendLogEntry = z.infer<typeof frontendLogEntrySchema>;

/** 前端日志批量请求体：{ logs: [...] }，也兼容单条格式；请求体必须是对象 */
export const frontendLogsSchema = z.object({
    logs: z.array(z.unknown()).optional(),
}).passthrough();

/** 校验单条日志 entry；不是对象时返回 null 由调用方跳过 */
export function parseFrontendLogEntry(entry: unknown): FrontendLogEntry | null {
    const result = frontendLogEntrySchema.safeParse(entry);
    return result.success ? result.data : null;
}

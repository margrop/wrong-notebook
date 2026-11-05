/**
 * AI 账户扩展接口：决定能否调用 AI、用哪套 AI 配置、用量记到哪里，以及用户删除后的清理。
 *
 * 默认实现（account-default.ts）即本项目自带的行为：全站共用一套 AI 配置、按每日次数限额、用量写入本地数据库。
 * 部署方可在构建时用环境变量 AI_ACCOUNT_EXTENSION 换成自己的实现，详见 doc/FORK_EXTENSION_POINTS.md。
 */

import type { AiLimitCode } from "@/lib/ai-limit-message";
import type { CompletionEvent } from "./completion";
import type { AiCallScope } from "./usage";

/** 调用前检查所需的信息：用户、操作和角色 */
export interface AiAuthorizeScope extends AiCallScope {
    role?: string | null;
}

/**
 * 拒绝调用的原因，接口返回 429，前端统一提示额度用完：
 * AI_DAILY_LIMIT_EXCEEDED 为每日次数上限，AI_QUOTA_INSUFFICIENT 为额度不足（如按量计费的余额用完）。
 * details 随错误响应返回。
 */
export interface AiAccessDenial {
    code: AiLimitCode;
    details?: Record<string, unknown>;
}

/** 为某个用户单独指定的 AI 配置：只支持 OpenAI 兼容接口 */
export interface AiProviderOverride {
    /** 记入用量的渠道名 */
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
}

export interface AiAccountProvider {
    /**
     * 调用前判断能否调用：返回 null 放行，否则返回拒绝原因。
     * AI 数据授权在此之前已检查，扩展不能跳过；抛错时按放行处理并记日志。
     */
    authorize(scope: AiAuthorizeScope): Promise<AiAccessDenial | null>;
    /** 返回该用户使用的 AI 配置；返回 null 时使用全站配置 */
    resolveConfig(scope: AiCallScope): Promise<AiProviderOverride | null>;
    /** 每次补全结束（成功或失败）后调用；出错只记日志，不影响业务 */
    record(scope: AiCallScope, provider: string, event: CompletionEvent): Promise<void>;
    /** 用户被删除后调用（自助注销、管理员删除、系统初始化）；出错只记日志 */
    onUserDeleted(userId: string): Promise<void>;
}

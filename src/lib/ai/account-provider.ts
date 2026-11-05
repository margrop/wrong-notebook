import "server-only";

// 构建时由 AI_ACCOUNT_EXTENSION 决定加载哪个实现（见 next.config.ts），默认为 ./account-default.ts
import { aiAccountProvider } from "@wrong-notebook/ai-account";
import { createLogger } from "@/lib/logger";
import type { AiAccountProvider } from "./account";

const logger = createLogger('ai:account');

/** 当前构建使用的 AI 账户实现 */
export function getAiAccountProvider(): AiAccountProvider {
    return aiAccountProvider;
}

/** 用户删除成功后通知 AI 账户实现；逐个通知，出错只记日志，不影响删除结果 */
export async function notifyAiAccountUsersDeleted(userIds: string[]): Promise<void> {
    for (const userId of userIds) {
        try {
            await getAiAccountProvider().onUserDeleted(userId);
        } catch (error) {
            logger.error({ error, userId }, 'AI account failed to handle user deletion');
        }
    }
}

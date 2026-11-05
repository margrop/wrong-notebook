import "server-only";

import type { AiAccountProvider } from "./account";
import { checkDailyLimit } from "./daily-limit";
import { recordAiCompletion } from "./usage";

/**
 * 默认的 AI 账户实现：每日次数限额、全站共用 AI 配置、用量写入本地 AiCompletion 表。
 * 自定义实现可以导入本对象，只替换需要改变的部分。
 */
export const aiAccountProvider: AiAccountProvider = {
    authorize: checkDailyLimit,
    resolveConfig: async () => null,
    record: recordAiCompletion,
    onUserDeleted: async () => undefined,
};

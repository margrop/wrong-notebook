import type { OpenAIInstance } from '../config/types';
import { getAppConfig } from '../config/store';

// 获取当前激活的 OpenAI 实例配置
export function getActiveOpenAIConfig(): OpenAIInstance | undefined {
    const config = getAppConfig();
    const instances = config.openai?.instances || [];
    const activeId = config.openai?.activeInstanceId;

    if (!activeId || instances.length === 0) {
        return undefined;
    }

    return instances.find(i => i.id === activeId);
}

// 最大实例数限制
export const MAX_OPENAI_INSTANCES = 10;

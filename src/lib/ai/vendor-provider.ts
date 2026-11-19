import 'server-only';

import { OpenAIProvider } from './openai-provider';
import { OpenAIResponsesProvider } from './openai-responses-provider';
import { resolveVendorConfig } from './vendor-presets';
import type { VendorConfig, VendorProviderId } from './vendor-presets';

/** 连接测试和业务调用共用渠道配置与传输协议 */
export function createVendorProvider(provider: VendorProviderId, settings?: VendorConfig) {
    const config = resolveVendorConfig(provider, settings);
    const service = provider === 'openai-responses' ? new OpenAIResponsesProvider(config) : new OpenAIProvider(config);
    return { service, config };
}

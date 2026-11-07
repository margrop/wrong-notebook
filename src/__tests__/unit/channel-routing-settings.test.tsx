/**
 * 渠道分工设置：三个下拉、当前生效渠道的预览，以及未配置渠道的就地填写
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelRoutingSettings } from '@/components/settings/channel-routing-settings';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { AppConfig } from '@/types/api';

vi.mock('@/components/settings/provider-config-form', () => ({
    ProviderConfigForm: ({ provider }: { provider: string }) => <div data-testid="provider-form">{provider}</div>,
}));
vi.mock('@/components/settings/minimax-code-settings', () => ({ MiniMaxCodeSettings: () => null }));
vi.mock('@/components/settings/openai-instance-settings', () => ({ OpenAIInstanceSettings: () => null }));
vi.mock('@/components/settings/vendor-settings', () => ({ VendorSettings: () => null }));
vi.mock('@/components/settings/anthropic-settings', () => ({ AnthropicSettings: () => null }));
vi.mock('@/components/settings/azure-settings', () => ({ AzureSettings: () => null }));
vi.mock('@/components/settings/gemini-settings', () => ({ GeminiSettings: () => null }));

let container: HTMLDivElement;
let root: Root;

const config: AppConfig = {
    aiProvider: 'deepseek',
    deepseek: { apiKey: 'k1', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
    glm: { apiKey: 'k2', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash' },
};

async function render(value: AppConfig, onSet: (next: (prev: AppConfig) => AppConfig) => void) {
    await act(async () => root.render(
        <LanguageProvider>
            <ChannelRoutingSettings config={value} setConfig={onSet as never} />
        </LanguageProvider>,
    ));
}

/** 某个标签对应的下拉框触发按钮 */
function triggerAfter(label: string): HTMLButtonElement {
    const labels = [...document.querySelectorAll('label')];
    const found = labels.find((item) => item.textContent === label);
    const container = found?.parentElement;
    const trigger = container?.querySelector<HTMLButtonElement>('button[role="combobox"]');
    if (!trigger) throw new Error('trigger not found: ' + label);
    return trigger;
}

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('渠道分工设置', () => {
    it('提供识别、文本和备用渠道三个选择，并显示当前生效渠道', async () => {
        await render(config, vi.fn());

        expect(document.body.textContent).toContain('图片识别渠道');
        expect(document.body.textContent).toContain('文本分析渠道');
        expect(document.body.textContent).toContain('备用渠道');
        expect(document.body.textContent).toContain('识别使用');
        expect(document.body.textContent).toContain('DeepSeek');
    });

    it('分开设置识别与文本渠道后，预览分别显示所选渠道', async () => {
        await render({ ...config, routing: { vision: 'glm', text: 'deepseek', fallback: '' } }, vi.fn());

        expect(triggerAfter('图片识别渠道').textContent).toContain('智谱 GLM');
        expect(triggerAfter('文本分析渠道').textContent).toContain('DeepSeek');
    });

    it('备用渠道已配置时预览显示主渠道与备用渠道', async () => {
        await render({ ...config, routing: { text: 'deepseek', fallback: 'glm' } }, vi.fn());

        expect(document.body.textContent).toContain('DeepSeek → 智谱 GLM');
    });

    it('备用渠道缺少密钥时不启用，也不显示为备用', async () => {
        await render({ aiProvider: 'deepseek', deepseek: { apiKey: 'k1' }, glm: {}, routing: { text: 'deepseek', fallback: 'glm' } }, vi.fn());

        expect(document.body.textContent).not.toContain('→ 智谱 GLM');
    });

    it('分工选中的其他渠道尚未配置时就地展开该渠道的配置表单', async () => {
        await render({ ...config, routing: { text: 'kimi', fallback: '' } }, vi.fn());

        expect(document.body.textContent).toContain('尚未配置');
        expect(container.querySelector('[data-testid="provider-form"]')?.textContent).toBe('kimi');
    });

    it('主渠道尚未配置时不在分工区重复渲染表单，提示到上方填写', async () => {
        // 主渠道的配置表单已显示在「渠道分工」上方，重复渲染会出现两份同样的输入框
        await render({ aiProvider: 'deepseek', deepseek: {}, routing: {} }, vi.fn());

        expect(document.body.textContent).toContain('尚未配置');
        expect(document.body.textContent).toContain('请在上方填写该渠道的设置');
        expect(container.querySelector('[data-testid="provider-form"]')).toBeNull();
    });
});

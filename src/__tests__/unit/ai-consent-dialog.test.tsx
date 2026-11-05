import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiConsentDialog } from '@/components/ai-consent-dialog';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { requestAiConsent } from '@/lib/ai-consent';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/lib/feedback';

const navigation = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next-auth/react', () => ({
    useSession: () => ({ status: 'authenticated', data: { user: { email: 'user@example.com' } } }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));
vi.mock('@/lib/feedback', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

/** 按接口地址返回授权状态与当前服务商 */
function mockServer(consentAt: string | null) {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => (url === '/api/user' ? { aiDataConsentAt: consentAt } : { aiProvider: 'gemini' }));
}

function findButton(text: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll('button')].find((button) => button.textContent?.includes(text));
}

beforeEach(() => {
    navigation.pathname = '/';
    sessionStorage.clear();
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

async function render() {
    await act(async () => root.render(<LanguageProvider><AiConsentDialog /></LanguageProvider>));
}

describe('AI 数据授权窗口', () => {
    it('尚未授权时主动弹出，列出发送的数据和当前服务商，同意后保存', async () => {
        mockServer(null);
        vi.mocked(apiClient.post).mockResolvedValue({ aiDataConsentAt: '2026-11-05T00:00:00Z' });
        await render();

        expect(document.body.textContent).toContain('题目的文字和图片');
        expect(document.body.textContent).toContain('当前服务商：Google Gemini');
        const policy = [...document.querySelectorAll('a')].find((link) => link.textContent === '隐私政策');
        expect(policy?.getAttribute('href')).toBe('https://wrong-notebook.margrop.net/privacy/');

        await act(async () => findButton('同意并继续')!.click());

        expect(apiClient.post).toHaveBeenCalledWith('/api/user/ai-consent', {});
        expect(toast.success).toHaveBeenCalledWith('已同意 AI 数据授权');
        expect(findButton('同意并继续')).toBeUndefined();
    });

    it('已授权时不弹出', async () => {
        mockServer('2026-11-01T00:00:00Z');
        await render();

        expect(findButton('同意并继续')).toBeUndefined();
    });

    it('暂不同意后本次浏览不再主动弹出，但 AI 请求被拒绝时仍会弹出', async () => {
        mockServer(null);
        await render();
        await act(async () => findButton('暂不同意')!.click());

        expect(apiClient.post).not.toHaveBeenCalled();
        expect(sessionStorage.getItem('ai-consent-dismissed:user@example.com')).toBe('1');

        await act(async () => root.unmount());
        root = createRoot(container);
        await render();
        expect(findButton('同意并继续')).toBeUndefined();

        await act(async () => requestAiConsent('blocked'));
        expect(document.body.textContent).toContain('这项操作需要使用 AI');
        expect(findButton('同意并继续')).toBeDefined();
    });

    it('登录、安装向导等页面不主动弹出', async () => {
        navigation.pathname = '/setup';
        mockServer(null);
        await render();

        expect(apiClient.get).not.toHaveBeenCalled();
        expect(findButton('同意并继续')).toBeUndefined();
    });
});

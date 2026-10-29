/**
 * 已有动画重新生成云端语音：只在云端语音且有讲解段落时显示，逐段重新合成并提示结果
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    mode: 'cloud' as 'cloud' | 'browser',
    regenerateSpeech: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/cloud-speech', () => ({
    getSpeechMode: () => Promise.resolve(mocks.mode),
    regenerateSpeech: mocks.regenerateSpeech,
}));
vi.mock('@/lib/feedback', () => ({ toast: mocks.toast }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));

import { LanguageProvider } from '@/contexts/LanguageContext';
import { RegenerateVoiceButton } from '@/components/svg-animation/regenerate-voice-button';
import { embedNarration } from '@/lib/svg-animation';
import { ApiError } from '@/lib/api-client';

const plain = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="10" height="10"/></svg>';
const narrated = embedNarration(plain, [{ begin: 0, text: '先看条件' }, { begin: 4, text: '再列方程' }]);

let root: Root;
let host: HTMLDivElement;
const onBusyChange = vi.fn();

async function render(svg: string) {
    await act(async () => {
        root.render(<LanguageProvider><RegenerateVoiceButton svg={svg} disabled={false} onBusyChange={onBusyChange} /></LanguageProvider>);
    });
}

const button = () => host.querySelector('button');

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.mode = 'cloud';
    localStorage.setItem('language', 'zh');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe('RegenerateVoiceButton', () => {
    it('浏览器语音或没有讲解段落时不显示', async () => {
        mocks.mode = 'browser';
        await render(narrated);
        expect(button()).toBeNull();

        mocks.mode = 'cloud';
        await render(plain);
        expect(button()).toBeNull();
    });

    it('逐段重新合成讲解稿的语音，显示进度，完成后提示', async () => {
        let finish!: () => void;
        mocks.regenerateSpeech.mockImplementation((_texts: string[], _language: string, onProgress: (done: number) => void) =>
            new Promise<void>((resolve) => { onProgress(1); finish = resolve; }));
        await render(narrated);
        expect(button()).not.toBeNull();

        await act(async () => { button()!.click(); });
        expect(mocks.regenerateSpeech).toHaveBeenCalledWith(['先看条件', '再列方程'], expect.any(String), expect.any(Function));
        expect(onBusyChange).toHaveBeenLastCalledWith(true);
        expect(button()!.textContent).toContain('1/2');
        expect(button()!.disabled).toBe(true);

        await act(async () => { finish(); });
        expect(mocks.toast.success).toHaveBeenCalled();
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
        expect(button()!.disabled).toBe(false);
    });

    it('失败时提示错误', async () => {
        mocks.regenerateSpeech.mockRejectedValue(new ApiError(502, 'Bad Gateway', { message: 'TTS_PROVIDER_ERROR' }));
        await render(narrated);
        await act(async () => { button()!.click(); });
        expect(mocks.toast.error).toHaveBeenCalled();
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
    });
});

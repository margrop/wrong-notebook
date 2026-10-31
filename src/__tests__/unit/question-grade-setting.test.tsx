import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionGradeSetting } from '@/components/settings/question-grade-setting';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.mocked(apiClient.get).mockResolvedValue({ gradeRecognitionMode: 'fixed', fixedGradeSemester: null });
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
    await act(async () => root.render(<LanguageProvider><QuestionGradeSetting /></LanguageProvider>));
}

async function select(id: string, value: string) {
    await act(async () => {
        const element = container.querySelector<HTMLSelectElement>(`#${id}`)!;
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function button(text: string) {
    return [...container.querySelectorAll('button')].find((element) => element.textContent === text)!;
}

describe('账户年级规则设置', () => {
    it('固定年级与模式一起保存，并显示保存结果', async () => {
        vi.mocked(apiClient.patch).mockResolvedValue({ gradeRecognitionMode: 'fixed', fixedGradeSemester: '四年级上' });
        await render();
        expect(button('保存年级规则').disabled).toBe(true);
        await select('question-fixed-grade', '四年级上');
        await act(async () => button('保存年级规则').click());
        expect(apiClient.patch).toHaveBeenCalledWith('/api/user', { gradeRecognitionMode: 'fixed', fixedGradeSemester: '四年级上' });
        expect(container.textContent).toContain('已保存');
        expect(button('保存年级规则').disabled).toBe(true);
    });

    it('切换到 AI 后隐藏固定年级选择，但保留已保存的固定值', async () => {
        vi.mocked(apiClient.get).mockResolvedValue({ gradeRecognitionMode: 'ai', fixedGradeSemester: '初一下' });
        vi.mocked(apiClient.patch).mockResolvedValue({ gradeRecognitionMode: 'fixed', fixedGradeSemester: '初一下' });
        await render();
        expect(container.querySelector('#question-fixed-grade')).toBeNull();
        expect(container.textContent).toContain('无法确定时保持未设置');
        await select('question-grade-mode', 'fixed');
        expect(container.querySelector<HTMLSelectElement>('#question-fixed-grade')!.value).toBe('初一下');
        await act(async () => button('保存年级规则').click());
        expect(apiClient.patch).toHaveBeenCalledWith('/api/user', { gradeRecognitionMode: 'fixed', fixedGradeSemester: '初一下' });
    });

    it('读取失败时禁用保存，重试成功后才允许修改', async () => {
        vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('模拟网络失败'));
        await render();
        expect(button('保存年级规则').disabled).toBe(true);
        expect(container.textContent).toContain('加载年级规则失败');
        await act(async () => button('重新加载').click());
        await select('question-grade-mode', 'ai');
        expect(button('保存年级规则').disabled).toBe(false);
    });
});

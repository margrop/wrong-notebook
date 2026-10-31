import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSettings } from '@/components/settings/account-settings';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));
vi.mock('@/lib/feedback', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

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

async function render() {
    await act(async () => root.render(<LanguageProvider><AccountSettings /></LanguageProvider>));
}

/** 在 Select 组件上模拟选择：找到 trigger button，点击打开，再点击对应项 */
async function selectOption(triggerIndex: number, optionText: string) {
    // Radix Select trigger 是 button
    const triggers = container.querySelectorAll<HTMLButtonElement>('[role="combobox"]');
    const trigger = triggers[triggerIndex];
    if (!trigger) throw new Error(`Select trigger ${triggerIndex} not found`);
    await act(async () => trigger.click());
    // 找到下拉面板中匹配的选项
    const options = document.querySelectorAll('[role="option"]');
    const target = [...options].find((el) => el.textContent === optionText);
    if (!target) throw new Error(`Option "${optionText}" not found`);
    await act(async () => (target as HTMLElement).click());
}

describe('账户设置的当前年级学期联动', () => {
    it('未选学段时不显示年级学期选择', async () => {
        vi.mocked(apiClient.get).mockResolvedValue({ name: '', email: '', educationStage: '', enrollmentYear: '', fixedGradeSemester: null });
        await render();
        expect(container.textContent).not.toContain('当前年级学期');
    });

    it('选择学段后显示年级选择，选完年级出现学期选择', async () => {
        vi.mocked(apiClient.get).mockResolvedValue({ name: '', email: '', educationStage: '', enrollmentYear: '', fixedGradeSemester: null });
        await render();
        // 第一个 select 是学段
        await selectOption(0, '小学');
        expect(container.textContent).toContain('当前年级学期');
        // 选年级（第二个 select）
        await selectOption(1, '三年级');
        expect(container.textContent).toContain('选择学期');
    });

    it('从 fixedGradeSemester 回填年级和学期', async () => {
        vi.mocked(apiClient.get).mockResolvedValue({ name: '', email: '', educationStage: 'junior_high', enrollmentYear: 2025, fixedGradeSemester: '初二下' });
        await render();
        expect(container.textContent).toContain('当前年级学期');
        // 年级应该是初二
        const triggers = container.querySelectorAll<HTMLButtonElement>('[role="combobox"]');
        expect(triggers[1]?.textContent).toContain('初二');
        // 学期应该是下学期
        expect(triggers[2]?.textContent).toContain('下学期');
    });

    it('保存时提交组装好的 fixedGradeSemester', async () => {
        vi.mocked(apiClient.get).mockResolvedValue({ name: '', email: '', educationStage: 'primary', enrollmentYear: '', fixedGradeSemester: null });
        vi.mocked(apiClient.patch).mockResolvedValue({});
        await render();
        await selectOption(1, '五年级');
        await selectOption(2, '上学期');
        await act(async () => {
            const saveBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('更新个人信息'))!;
            saveBtn.click();
        });
        expect(apiClient.patch).toHaveBeenCalledWith('/api/user', expect.objectContaining({
            educationStage: 'primary',
            fixedGradeSemester: '五年级上',
        }));
    });

    it('清除年级后提交 fixedGradeSemester 为 null', async () => {
        vi.mocked(apiClient.get).mockResolvedValue({ name: '', email: '', educationStage: 'junior_high', enrollmentYear: 2025, fixedGradeSemester: '初三上' });
        vi.mocked(apiClient.patch).mockResolvedValue({});
        await render();
        // 年级回填为初三，清除：选择空选项（Radix Select 的 placeholder 项）
        // 通过重新选学段触发重置来模拟清除
        await selectOption(0, '高中');
        await act(async () => {
            const saveBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('更新个人信息'))!;
            saveBtn.click();
        });
        expect(apiClient.patch).toHaveBeenCalledWith('/api/user', expect.objectContaining({
            fixedGradeSemester: null,
        }));
    });
});

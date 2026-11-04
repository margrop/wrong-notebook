import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signOut } from 'next-auth/react';
import { DeleteAccountSettings } from '@/components/settings/delete-account-settings';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { apiClient, ApiError } from '@/lib/api-client';
import { toast } from '@/lib/feedback';

vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('@/lib/api-client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/api-client')>();
    return { ...actual, apiClient: { delete: vi.fn() } };
});
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));
vi.mock('@/lib/feedback', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.clearAllMocks();
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

async function render(isAdmin: boolean) {
    await act(async () => root.render(<LanguageProvider><DeleteAccountSettings isAdmin={isAdmin} /></LanguageProvider>));
}

/** 打开确认弹窗、输入密码并提交 */
async function submitWithPassword(password: string) {
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    const input = document.querySelector<HTMLInputElement>('#delete-account-password')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
        setValue.call(input, password);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
        input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
}

describe('注销账号设置', () => {
    it('管理员的注销按钮不可用，并说明原因', async () => {
        await render(true);

        expect(container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
        expect(container.textContent).toContain('管理员账号不能自助注销');
    });

    it('普通用户输入密码后注销并退出登录', async () => {
        vi.mocked(apiClient.delete).mockResolvedValue({ success: true });
        await render(false);

        await submitWithPassword('secret1');

        expect(apiClient.delete).toHaveBeenCalledWith('/api/user', { body: JSON.stringify({ password: 'secret1' }) });
        expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
    });

    it('密码错误时提示并保持登录', async () => {
        vi.mocked(apiClient.delete).mockRejectedValue(new ApiError(400, 'Bad Request', { message: 'Incorrect password' }));
        await render(false);

        await submitWithPassword('wrong');

        expect(toast.error).toHaveBeenCalledWith('密码错误');
        expect(signOut).not.toHaveBeenCalled();
    });
});

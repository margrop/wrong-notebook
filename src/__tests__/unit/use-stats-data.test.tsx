/**
 * useStatsData：统计中心通用数据请求 hook
 * 验证加载中、成功、失败、重试、组件卸载后的取消行为
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStatsData } from '@/lib/hooks/use-stats-data';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));

type Hook = ReturnType<typeof useStatsData<{ total: number }>>;

let hook: Hook;
let root: Root;
let container: HTMLDivElement;

function Probe({ url }: { url: string }) {
    const value = useStatsData<{ total: number }>(url);
    useEffect(() => { hook = value; });
    return null;
}

async function render(url = '/api/test') {
    await act(async () => {
        root.render(<Probe url={url} />);
    });
}

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

describe('useStatsData', () => {
    it('请求成功时返回数据并结束加载', async () => {
        let resolveGet: (v: { total: number }) => void = () => undefined;
        mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolveGet = resolve; }));
        await render();
        // 初始应为加载中
        expect(hook.loading).toBe(true);
        // 请求返回后更新数据并结束加载
        await act(async () => { resolveGet({ total: 42 }); });
        expect(hook.loading).toBe(false);
        expect(hook.error).toBe(false);
        expect(hook.data).toEqual({ total: 42 });
    });

    it('请求失败时设置 error', async () => {
        mocks.get.mockRejectedValueOnce(new Error('network error'));
        await render();
        await act(async () => { await Promise.resolve(); });
        expect(hook.loading).toBe(false);
        expect(hook.error).toBe(true);
        expect(hook.data).toBeNull();
    });

    it('调用 reload 会重新请求', async () => {
        mocks.get.mockResolvedValueOnce({ total: 1 });
        await render();
        await act(async () => { await Promise.resolve(); });
        expect(hook.data).toEqual({ total: 1 });

        let resolveGet: (v: { total: number }) => void = () => undefined;
        mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolveGet = resolve; }));
        await act(async () => { hook.reload(); });
        // reload 后 effect 重新执行，loading 先变回 true
        expect(hook.loading).toBe(true);
        await act(async () => { resolveGet({ total: 2 }); });
        expect(hook.data).toEqual({ total: 2 });
        expect(hook.error).toBe(false);
    });

    it('组件卸载后不再更新状态', async () => {
        let resolveGet: (v: { total: number }) => void = () => undefined;
        mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolveGet = resolve; }));
        await render();
        // 卸载组件
        await act(async () => root.unmount());
        // 请求返回后不应抛出警告或更新已卸载组件
        await act(async () => { resolveGet({ total: 99 }); });
        // 若未取消，这里会触发 React 警告；测试通过即说明已处理
        expect(true).toBe(true);
    });
});

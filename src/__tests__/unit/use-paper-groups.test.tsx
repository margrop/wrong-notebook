import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { invalidatePaperGroupsCache, usePaperGroups } from '@/lib/use-paper-groups';

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));
let root: Root;
let container: HTMLDivElement;
function Consumer({ name }: { name: string }) {
    const { groups, refetch } = usePaperGroups();
    return <section data-testid={name}>{groups.map((group) => group.name).join(',')}
        <button onClick={() => { void refetch(); }}>重新加载</button></section>;
}
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    invalidatePaperGroupsCache();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(apiClient.get).mockResolvedValue([{ id: 'a', name: 'A卷', key: 'a', order: 0, isActive: true }]);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('多个组件共享卷别缓存', () => {
    it('设置组件刷新后，已挂载的录入组件同步显示新增或改名后的分组', async () => {
        await act(async () => root.render(<><Consumer name="settings" /><Consumer name="entry" /></>));
        expect(container.querySelector('[data-testid="entry"]')!.textContent).toContain('A卷');
        vi.mocked(apiClient.get).mockResolvedValue([{ id: 'a', name: '期中考试', key: 'a', order: 0, isActive: true },
            { id: 'custom', name: '新分组', key: null, order: 1, isActive: true }]);
        await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="settings"] button')!.click());
        expect(container.querySelector('[data-testid="entry"]')!.textContent).toContain('期中考试,新分组');
        expect(container.querySelector('[data-testid="entry"]')!.textContent).not.toContain('A卷');
    });
});

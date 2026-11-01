import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionMetadata } from '@/components/error-detail/question-metadata';
import type { ErrorItemDetail } from '@/components/error-detail/types';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
    apiClient: {
        put: vi.fn(),
        get: vi.fn(async (url: string) => {
            if (url === '/api/paper-groups') return [
                { id: 'group-a', name: 'A卷', key: 'a', order: 0, isActive: true },
                { id: 'group-b', name: 'B卷', key: 'b', order: 1, isActive: true },
                { id: 'group-other', name: '其他', key: 'other', order: 2, isActive: true },
            ];
            return {};
        }),
    },
}));
vi.mock('@/components/notebook-selector', () => ({ NotebookSelector: () => null }));
vi.mock('@/components/paper-group-select', () => ({
    PaperGroupSelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="group-a">A卷</option>
            <option value="group-b">B卷</option>
            <option value="group-other">其他</option>
        </select>
    ),
}));
vi.mock('@/lib/feedback', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;
const onChanged = vi.fn();

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

async function render(gradeSemester = '初一，上期', paperLevel?: string) {
    const item: ErrorItemDetail = { id: 'e1', questionText: '题目', answerText: '', analysis: '', knowledgePoints: '[]', tags: [], masteryLevel: 0, originalImageUrl: '', userNotes: null, gradeSemester, paperLevel };
    await act(async () => root.render(<LanguageProvider><QuestionMetadata item={item} onChanged={onChanged} /></LanguageProvider>));
}

async function click(label: string) {
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === label)!.click());
}

describe('题目试卷信息编辑入口', () => {
    it('只渲染一个编辑按钮，避免与年级行重复', async () => {
        await render('初一，上期', 'group-a');
        expect(container.querySelectorAll('button')).toHaveLength(1);
        expect(container.querySelector('button')!.textContent).toBe('编辑');
    });

    it.each([undefined, 'group-a', 'inactive-group'])('修改年级时不重复提交未改变的卷别 %s', async (paperLevel) => {
        await render('初一，上期', paperLevel);
        await click('编辑');
        const select = container.querySelector<HTMLSelectElement>('#detail-grade-semester')!;
        expect(select.value).toBe('初一，上期');
        await act(async () => {
            select.value = '高二下';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await click('保存');
        expect(apiClient.put).toHaveBeenCalledWith('/api/error-items/e1', { gradeSemester: '高二下' });
        expect(onChanged).toHaveBeenCalledOnce();
    });

    it('手工改组时提交选中的卷别分组 ID', async () => {
        await render('初二上', 'group-a');
        await click('编辑');
        const select = [...container.querySelectorAll('select')].find((element) => element.value === 'group-a')!;
        await act(async () => {
            select.value = 'group-b';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await click('保存');
        expect(apiClient.put).toHaveBeenCalledWith('/api/error-items/e1', { gradeSemester: '初二上', paperLevel: 'group-b' });
        expect(onChanged).toHaveBeenCalledOnce();
    });

    it('保留旧的自定义年级，取消时不保存', async () => {
        await render('大学拓展课程');
        await click('编辑');
        expect(container.querySelector<HTMLSelectElement>('#detail-grade-semester')!.value).toBe('大学拓展课程');
        await click('取消');
        expect(apiClient.put).not.toHaveBeenCalled();
        expect(container.textContent).toContain('大学拓展课程');
    });
});

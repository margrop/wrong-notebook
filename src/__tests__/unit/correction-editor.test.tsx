import { act } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionEditor } from '@/components/correction-editor';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { apiClient } from '@/lib/api-client';
import { translations } from '@/lib/translations';

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(async (url: string) => {
    if (url === '/api/notebooks') return [];
    if (url === '/api/paper-groups') return [
        { id: 'group-a', name: 'A卷', key: 'a', order: 0, isActive: true },
        { id: 'group-b', name: 'B卷', key: 'b', order: 1, isActive: true },
        { id: 'group-other', name: '其他', key: 'other', order: 2, isActive: true },
    ];
    return {};
}), post: vi.fn() } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/notebook-selector', () => ({ NotebookSelector: () => null }));
vi.mock('@/components/tag-input', () => ({ TagInput: () => null }));
vi.mock('@/components/markdown-renderer', () => ({ MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span> }));
vi.mock('@/components/geogebra-demo', () => ({ GeogebraDemo: () => null }));
vi.mock('@/components/paper-group-select', () => ({
    PaperGroupSelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="group-a">A卷</option>
            <option value="group-b">B卷</option>
            <option value="group-other">其他</option>
        </select>
    ),
}));
vi.mock('@/components/ui/select', () => ({
    Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => <select value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
    SelectTrigger: () => null,
    SelectValue: () => null,
}));

let container: HTMLDivElement;
let root: Root;
const onSave = vi.fn(async () => undefined);

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('alert', vi.fn());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

async function renderEditor(extra: Partial<ComponentProps<typeof CorrectionEditor>['initialData']> = {}) {
    await act(async () => root.render(
        <LanguageProvider><CorrectionEditor initialData={{
            questionText: '求和', answerText: '4', analysis: '解析', subject: '数学', knowledgePoints: [], requiresImage: false,
            wrongAnswerText: '', mistakeAnalysis: '', mistakeStatus: 'unknown', ...extra,
        }} initialSubjectId="math" onSave={onSave} onCancel={() => undefined} /></LanguageProvider>,
    ));
}
const paperSelect = () => Array.from(container.querySelectorAll('select')).find((select) => select.querySelector('option[value="group-other"]'))!;
const clickStar = (stars: number) => act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="设为 ${stars} 星"]`)!.click());
const clickButton = (text: string) => act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text))!.click());
const selectPaper = (value: string) => act(async () => {
    const select = paperSelect();
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
});

describe('校对页的默认卷别与手工覆盖', () => {
    it('保留题目已有的年级，允许选择其他年级后保存', async () => {
        await renderEditor({ gradeSemester: '四年级上' });
        const select = container.querySelector<HTMLSelectElement>('#correction-grade-semester')!;
        expect(select.value).toBe('四年级上');
        await act(async () => {
            select.value = '六年级下';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await clickButton(translations.zh.editor.save);
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ gradeSemester: '六年级下' }));
    });

    it('账户资料晚返回时不覆盖已经手工修改的年级', async () => {
        let resolveProfile!: (profile: { educationStage: string; enrollmentYear: number }) => void;
        const pending = new Promise<{ educationStage: string; enrollmentYear: number }>((resolve) => { resolveProfile = resolve; });
        vi.mocked(apiClient.get).mockImplementation(async (url) => url === '/api/notebooks' ? [] : url === '/api/paper-groups' ? [
            { id: 'group-a', name: 'A卷', key: 'a', order: 0, isActive: true },
            { id: 'group-b', name: 'B卷', key: 'b', order: 1, isActive: true },
            { id: 'group-other', name: '其他', key: 'other', order: 2, isActive: true },
        ] : pending);
        await renderEditor();
        const select = container.querySelector<HTMLSelectElement>('#correction-grade-semester')!;
        await act(async () => {
            select.value = '五年级下';
            select.dispatchEvent(new Event('change', { bubbles: true }));
            resolveProfile({ educationStage: 'junior_high', enrollmentYear: 2024 });
        });
        expect(select.value).toBe('五年级下');
        vi.mocked(apiClient.get).mockImplementation(async (url) => url === '/api/notebooks' ? [] : url === '/api/paper-groups' ? [
            { id: 'group-a', name: 'A卷', key: 'a', order: 0, isActive: true },
            { id: 'group-b', name: 'B卷', key: 'b', order: 1, isActive: true },
            { id: 'group-other', name: '其他', key: 'other', order: 2, isActive: true },
        ] : {});
    });

    it.each([[1, 'group-a'], [2, 'group-a'], [3, 'group-a'], [4, 'group-b'], [5, 'group-b']] as const)('%i 星校对题默认显示并保存为 %s 分组', async (difficultyStars, paperLevel) => {
        await renderEditor({ difficultyStars });
        expect(paperSelect().value).toBe(paperLevel);
        await clickButton(translations.zh.editor.save);
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ paperLevel, difficultyStars }));
    });

    it('未手工选卷时，修改星级会更新默认卷别', async () => {
        await renderEditor({ difficultyStars: 3 });
        await clickStar(4);
        expect(paperSelect().value).toBe('group-b');
        await clickStar(2);
        expect(paperSelect().value).toBe('group-a');
    });

    it('手工改为 A 卷后，再修改星级仍保留手工选择', async () => {
        await renderEditor({ difficultyStars: 4 });
        await selectPaper('group-a');
        await clickStar(5);
        expect(paperSelect().value).toBe('group-a');
        await clickButton(translations.zh.editor.save);
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ paperLevel: 'group-a', difficultyStars: 5 }));
    });

    it('重新解题补评星级会更新默认卷别，手工选择「其他」后保留', async () => {
        vi.mocked(apiClient.post).mockResolvedValue({ answerText: '4', analysis: '解析', knowledgePoints: [], mistakeStatus: 'unknown', difficultyStars: 5 });
        await renderEditor();
        await clickButton(translations.zh.editor.reanswer);
        await act(async () => {}); // 等待 setData 生效
        expect(paperSelect().value).toBe('group-b');
        await selectPaper('group-other');
        await clickButton(translations.zh.editor.reanswer);
        await act(async () => {}); // 等待 setData 生效
        expect(paperSelect().value).toBe('group-other');
    });
});

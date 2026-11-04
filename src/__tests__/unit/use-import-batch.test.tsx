/**
 * 分题草稿自动保存：多处同时触发保存时串行合并、只提交最新内容、不与自己冲突；
 * 其他页面先保存时载入最新版本，本页修改保留为可恢复的副本
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportBatchDetail } from '@/lib/import/import-batch-types';
import type { BatchDraft } from '@/lib/question-split/draft';
import { updateItem } from '@/lib/question-split/draft-ops';
import { useImportBatch } from '@/lib/hooks/use-import-batch';

const server = vi.hoisted(() => ({
    version: 1,
    draft: null as unknown as BatchDraft,
    calls: [] as Array<{ version: number; text: string }>,
    gate: null as Promise<void> | null,
}));

vi.mock('@/lib/import/import-batch-client', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/import/import-batch-client')>();
    const detail = () => ({ id: 'batch-1', source: 'text', status: 'draft', phase: 'draft', version: server.version, draft: server.draft, imageData: null, tasks: [], counts: { total: 0, active: 0, review: 0, saved: 0, duplicate: 0, failed: 0 } }) as unknown as ImportBatchDetail;
    return {
        ...original,
        fetchImportBatch: vi.fn(async () => detail()),
        saveImportBatchDraft: vi.fn(async (_id: string, version: number, draft: BatchDraft) => {
            server.calls.push({ version, text: draft.items[0].text });
            if (server.gate) await server.gate;
            if (version !== server.version) {
                throw Object.assign(new Error('conflict'), { status: 409, data: { message: 'IMPORT_BATCH_VERSION_CONFLICT', details: { batch: detail() } } });
            }
            server.version += 1;
            server.draft = draft;
            return detail();
        }),
    };
});

type Hook = ReturnType<typeof useImportBatch>;
let hook: Hook;
let root: Root;
let container: HTMLDivElement;

function Consumer() {
    const value = useImportBatch('batch-1');
    // 渲染提交后再交给测试读取，不在渲染期间改写外部变量
    useEffect(() => {
        hook = value;
    });
    return null;
}

const baseDraft = (text: string): BatchDraft => ({
    items: [{ key: 'qa', label: '1', text, material: null, section: null, selected: true, regions: [], hasFigure: false, flags: [] }],
    ignored: [], warnings: [],
});
const setText = (text: string) => act(() => hook.edit((draft) => updateItem(draft, 'qa', { text }), 'text-qa'));

beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    server.version = 1;
    server.draft = baseDraft('原文');
    server.calls = [];
    server.gate = null;
    container = document.createElement('div');
    root = createRoot(container);
    await act(async () => root.render(<Consumer />));
    await act(async () => { await Promise.resolve(); });
    expect(hook.draft?.items[0].text).toBe('原文');
});

afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
});

describe('分题草稿自动保存', () => {
    it('慢保存期间继续输入、多处同时触发保存：串行提交最新内容，不与自己冲突', async () => {
        let release: () => void = () => undefined;
        server.gate = new Promise((resolve) => { release = resolve; });
        await setText('第一次修改');
        let first!: Promise<boolean>;
        await act(async () => { first = hook.save(); });
        // 第一次保存还没返回时继续输入，并由页面隐藏、开始按钮等同时触发保存
        await setText('最终内容');
        let second!: Promise<boolean>;
        let third!: Promise<boolean>;
        await act(async () => {
            second = hook.save();
            third = hook.save();
        });
        server.gate = null;
        await act(async () => {
            release();
            expect(await Promise.all([first, second, third])).toEqual([true, true, true]);
        });
        expect(server.calls).toEqual([{ version: 1, text: '第一次修改' }, { version: 2, text: '最终内容' }]);
        expect(server.draft.items[0].text).toBe('最终内容');
        expect(hook.saveState).toBe('saved');
        expect(hook.conflictCopy).toBeNull();
    });

    it('其他页面先保存时载入最新版本，本页修改保留为副本，可恢复后在最新版本上保存', async () => {
        // 另一页面已保存
        server.version = 2;
        server.draft = baseDraft('另一页面的修改');
        await setText('本页的修改');
        await act(async () => {
            expect(await hook.save()).toBe(false);
        });
        expect(hook.draft?.items[0].text).toBe('另一页面的修改');
        expect(hook.conflictCopy?.items[0].text).toBe('本页的修改');

        await act(async () => { hook.restoreConflictCopy(); });
        await act(async () => {
            expect(await hook.save()).toBe(true);
        });
        expect(server.calls.at(-1)).toEqual({ version: 2, text: '本页的修改' });
        expect(server.draft.items[0].text).toBe('本页的修改');
        expect(hook.conflictCopy).toBeNull();
        // 恢复也可撤销
        expect(hook.canUndo).toBe(true);
    });
});

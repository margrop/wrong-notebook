/**
 * POST /api/import 备份导入按 target 防重复：同一用户同时只允许一个导入任务。
 * 并发第二个请求返回 409 TASK_ALREADY_RUNNING，不重复写库。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetBackgroundTasksForTest } from '@/lib/background-tasks';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    userFindUnique: vi.fn(),
    transaction: vi.fn(),
    importBackupData: vi.fn(),
    scheduleImportMasteryEvaluation: vi.fn(),
    importSpeeches: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: { findUnique: mocks.userFindUnique },
        $transaction: mocks.transaction,
    },
}));
vi.mock('@/lib/backup/import-writer', () => ({
    importBackupData: mocks.importBackupData,
    scheduleImportMasteryEvaluation: mocks.scheduleImportMasteryEvaluation,
}));
vi.mock('@/lib/tts/speech-cache', () => ({ importSpeeches: mocks.importSpeeches }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { POST as IMPORT } from '@/app/api/import/route';

const validBackup = {
    version: 11,
    user: { email: 'user@example.com' },
    subjects: [],
    knowledgeTags: [],
    errorItems: [],
    reviewSchedules: [],
    practiceRecords: [],
    examPapers: [],
    ttsSpeeches: [],
};

const importRequest = (body: unknown) => IMPORT(new Request('http://localhost/api/import', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
}));

describe('POST /api/import 按 target 防重复', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetBackgroundTasksForTest();
        mocks.getServerSession.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com', role: 'user' }, expires: '2099-01-01' });
        mocks.userFindUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
        mocks.importBackupData.mockResolvedValue({ stats: {}, masteryIds: [] });
        mocks.importSpeeches.mockResolvedValue(0);
        mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
    });

    it('正常导入返回 200', async () => {
        const response = await importRequest(validBackup);
        expect(response.status).toBe(200);
        expect(mocks.importBackupData).toHaveBeenCalledTimes(1);
    });

    it('并发导入时第二个请求返回 409，不重复写库', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
            await gate;
            return fn({});
        });

        const first = importRequest(validBackup);
        // 等第一个请求完成 reserve 并进入 transaction
        await new Promise((resolve) => setTimeout(resolve, 0));

        const second = await importRequest(validBackup);
        expect(second.status).toBe(409);
        const body = await second.json() as { code?: string };
        expect(body.code).toBe('TASK_ALREADY_RUNNING');
        expect(mocks.transaction).toHaveBeenCalledTimes(1);

        release();
        await first;
        expect(mocks.importBackupData).toHaveBeenCalledTimes(1);
    });

    it('导入完成后可再次导入（running 结束不残留）', async () => {
        expect((await importRequest(validBackup)).status).toBe(200);
        expect((await importRequest(validBackup)).status).toBe(200);
        expect(mocks.importBackupData).toHaveBeenCalledTimes(2);
    });

    it('非当前用户的备份数据返回 400', async () => {
        const response = await importRequest({ ...validBackup, user: { email: 'other@example.com' } });
        expect(response.status).toBe(400);
        expect(mocks.importBackupData).not.toHaveBeenCalled();
    });
});

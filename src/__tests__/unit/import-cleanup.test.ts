// @vitest-environment node
/**
 * 识别任务与批次的保留期清理（真实 SQLite）：已保存任务按自身结束时间过期、
 * finishedAt 为空时回退 updatedAt、待校对/失败/执行中任务保留、空批次一并删除
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: undefined as PrismaClient | undefined }));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { purgeImportTasks, startImportCleanupScheduler } from '@/lib/import/import-cleanup';

const DAY = 24 * 60 * 60 * 1000;

let database: PrismaClient;
let directory: string;

beforeAll(async () => {
    // 只使用系统临时数据库，不接触开发或生产数据
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-import-cleanup-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    await database.$queryRaw`PRAGMA journal_mode = WAL`;
    await database.$queryRaw`PRAGMA busy_timeout = 30000`;
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    await database.importTask.deleteMany();
    await database.importBatch.deleteMany();
    await database.user.deleteMany();
    await database.user.createMany({ data: [
        { id: 'user-1', email: 'cleanup@example.com', password: 'test-only' },
        { id: 'user-2', email: 'other@example.com', password: 'test-only' },
    ] });
}, 30000);

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

/** 建一条任务记录；日期字段都按 now 计算 */
function task(id: string, overrides: Partial<Parameters<typeof database.importTask.create>[0]['data']> = {}) {
    return { id, userId: 'user-1', mode: 'auto', status: 'saved', imageData: '', ...overrides };
}

describe('识别任务保留期清理', () => {
    it('已保存任务超过 7 天被删除，未超过与未结束的保留', async () => {
        const now = new Date();
        const old = new Date(now.getTime() - 10 * DAY);
        const recent = new Date(now.getTime() - 2 * DAY);
        await database.importTask.createMany({ data: [
            task('old-saved', { finishedAt: old, createdAt: old }),
            task('recent-saved', { finishedAt: recent, createdAt: recent }),
            task('old-review', { status: 'review', finishedAt: old, createdAt: old }),
            task('old-failed', { status: 'failed', finishedAt: old, createdAt: old }),
            task('old-analyzing', { status: 'analyzing', createdAt: old }),
            task('old-saving', { status: 'saving', createdAt: old }),
        ] });

        expect(await purgeImportTasks(now, 'user-1')).toMatchObject({ tasks: 1 });
        const remaining = await database.importTask.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
        expect(remaining.map((row) => row.id)).toEqual(['old-analyzing', 'old-failed', 'old-review', 'old-saving', 'recent-saved']);
    });

    it('finishedAt 为空时按 updatedAt 判断，避免历史数据永不清理', async () => {
        const now = new Date();
        const old = new Date(now.getTime() - 10 * DAY);
        await database.importTask.create({ data: {
            ...task('old-saved-null-finish', { finishedAt: null, createdAt: old }),
            updatedAt: old,
        } });
        expect(await purgeImportTasks(now, 'user-1')).toMatchObject({ tasks: 1 });
        expect(await database.importTask.count()).toBe(0);
    });

    it('批次内的已保存任务按自身保留期清理，仍有未处理题的批次保留', async () => {
        const now = new Date();
        const old = new Date(now.getTime() - 10 * DAY);
        await database.importBatch.createMany({ data: [
            { id: 'batch-open', userId: 'user-1', source: 'text', splitter: 'local', status: 'started', mode: 'review', startedAt: old, createdAt: old },
            { id: 'batch-done', userId: 'user-1', source: 'text', splitter: 'local', status: 'started', mode: 'auto', startedAt: old, createdAt: old },
            { id: 'batch-draft', userId: 'user-1', source: 'text', splitter: 'local', status: 'draft', createdAt: old },
        ] });
        await database.importTask.createMany({ data: [
            task('batch-open-old', { batchId: 'batch-open', finishedAt: old, createdAt: old }),
            task('batch-open-review', { batchId: 'batch-open', status: 'review', createdAt: old }),
            task('batch-done-old', { batchId: 'batch-done', finishedAt: old, createdAt: old }),
        ] });

        expect(await purgeImportTasks(now, 'user-1')).toMatchObject({ tasks: 2, batches: 1 });
        // 只剩一道待校对题的批次保留，草稿批次不受影响
        expect(await database.importBatch.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).toEqual([
            { id: 'batch-draft' }, { id: 'batch-open' },
        ]);
        expect(await database.importTask.findMany({ select: { id: true } })).toEqual([{ id: 'batch-open-review' }]);
    });

    it('不给 userId 时清理所有用户，但只删已开始的空批次', async () => {
        const now = new Date();
        const old = new Date(now.getTime() - 10 * DAY);
        await database.importBatch.create({ data: { id: 'empty-old-batch', userId: 'user-1', source: 'text', splitter: 'local', status: 'started', mode: 'auto', startedAt: old, createdAt: old } });
        await database.importTask.createMany({ data: [
            task('u1-old', { finishedAt: old, createdAt: old }),
            task('u2-old', { userId: 'user-2', finishedAt: old, createdAt: old }),
            task('u2-fresh', { userId: 'user-2', finishedAt: now, createdAt: old }),
        ] });
        expect(await purgeImportTasks(now)).toMatchObject({ tasks: 2, batches: 1 });
        expect(await database.importTask.findMany({ select: { id: true } })).toEqual([{ id: 'u2-fresh' }]);
        expect(await database.importBatch.count()).toBe(0);
    });

    it('开始时间未到保留期的空批次不清理', async () => {
        const now = new Date();
        const recent = new Date(now.getTime() - DAY);
        await database.importBatch.create({ data: { id: 'empty-fresh-batch', userId: 'user-1', source: 'text', splitter: 'local', status: 'started', mode: 'auto', startedAt: recent, createdAt: recent } });
        expect(await purgeImportTasks(now)).toMatchObject({ tasks: 0, batches: 0 });
        expect(await database.importBatch.count()).toBe(1);
    });
});

describe('定时清理', () => {
    /** 启动调度器前重置全局标记，避免与其他用例共用状态 */
    function freshScheduler() {
        const globalState = globalThis as { __importCleanupStarted?: boolean };
        globalState.__importCleanupStarted = false;
    }

    it('启动一分钟后清理一次，之后每 6 小时一次，且重复启动不叠加定时器', async () => {
        vi.useFakeTimers();
        try {
            freshScheduler();
            // 记录清理次数：真实 SQLite 中已放置一条过期任务
            const old = new Date(Date.now() - 10 * DAY);
            await database.importTask.create({ data: task('scheduled-old', { finishedAt: old, createdAt: old }) });
            startImportCleanupScheduler();
            startImportCleanupScheduler();
            // 启动后只有待触发的首次清理；一分钟时执行并转成 6 小时周期定时器
            expect(vi.getTimerCount()).toBe(1);
            expect(await database.importTask.count()).toBe(1);
            await vi.advanceTimersByTimeAsync(60 * 1000);
            expect(vi.getTimerCount()).toBe(1);
            await vi.waitFor(async () => { expect(await database.importTask.count()).toBe(0); });
            await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
            expect(vi.getTimerCount()).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

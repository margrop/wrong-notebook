import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearFinishedBackgroundTasks,
    describeQuestion,
    findRunningTask,
    FINISHED_TASK_TTL_MS,
    flushBackgroundTasksForTest,
    listBackgroundTasks,
    resetBackgroundTasksForTest,
    reserveBackgroundTask,
    runReservedTask,
    SERVER_RESTARTED,
    startBackgroundTask,
    trackBackgroundTask,
} from '@/lib/background-tasks';

vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

beforeEach(() => resetBackgroundTasksForTest());
afterEach(() => vi.useRealTimers());

describe('后台事务登记', () => {
    it('trackBackgroundTask 运行时为进行中，完成后为成功，返回结果', async () => {
        let resolve!: (value: string) => void;
        const running = trackBackgroundTask({ userId: 'u1', kind: 'svg_animation', subject: 'hA6PB9 求面积', link: '/error-items/e1' }, () => new Promise<string>((r) => { resolve = r; }));

        expect(listBackgroundTasks('u1')).toMatchObject([{ kind: 'svg_animation', status: 'running', subject: 'hA6PB9 求面积', link: '/error-items/e1', finishedAt: null }]);
        resolve('svg');
        expect(await running).toBe('svg');
        expect(listBackgroundTasks('u1')[0]).toMatchObject({ status: 'succeeded', error: null });
        expect(listBackgroundTasks('u1')[0].finishedAt).not.toBeNull();
    });

    it('失败时记录错误码并继续抛出', async () => {
        await expect(trackBackgroundTask({ userId: 'u1', kind: 'reanswer' }, async () => { throw new Error('AI_RESPONSE_ERROR: 格式不对'); })).rejects.toThrow('AI_RESPONSE_ERROR');
        expect(listBackgroundTasks('u1')[0]).toMatchObject({ status: 'failed', error: 'AI_RESPONSE_ERROR' });
    });

    it('批量事务记录进度，结束后状态不再改变', () => {
        const task = startBackgroundTask({ userId: 'u1', kind: 'retag_notebook', total: 3 });
        expect(listBackgroundTasks('u1')[0].progress).toEqual({ done: 0, total: 3, failed: 0 });
        task.setProgress(2, 3, 1);
        expect(listBackgroundTasks('u1')[0].progress).toEqual({ done: 2, total: 3, failed: 1 });
        task.succeed();
        task.fail(new Error('late'));
        expect(listBackgroundTasks('u1')[0]).toMatchObject({ status: 'succeeded', error: null });
    });

    it('只返回本人的事务：进行中的在前，不暴露用户 ID', () => {
        startBackgroundTask({ userId: 'u2', kind: 'analyze' });
        const done = startBackgroundTask({ userId: 'u1', kind: 'figure' });
        done.succeed();
        startBackgroundTask({ userId: 'u1', kind: 'exam', total: 5 });

        const list = listBackgroundTasks('u1');
        expect(list.map((task) => task.kind)).toEqual(['exam', 'figure']);
        expect(list[0]).not.toHaveProperty('userId');
    });

    it('已结束的事务 30 分钟后清理，也可手动清除，进行中的保留', () => {
        vi.useFakeTimers();
        startBackgroundTask({ userId: 'u1', kind: 'analyze' }).succeed();
        startBackgroundTask({ userId: 'u1', kind: 'svg_animation' });
        vi.advanceTimersByTime(FINISHED_TASK_TTL_MS + 1000);
        expect(listBackgroundTasks('u1').map((task) => task.kind)).toEqual(['svg_animation']);

        startBackgroundTask({ userId: 'u1', kind: 'figure' }).fail(new Error('x'));
        clearFinishedBackgroundTasks('u1');
        expect(listBackgroundTasks('u1').map((task) => task.status)).toEqual(['running']);
    });

    it('题目说明为编号加去掉公式符号的题干开头', () => {
        expect(describeQuestion({ shortId: 'hA6PB9', questionText: '已知 $\\frac{1}{2}x = 3$，\n求 **x** 的值，并说明理由，写出完整的过程和步骤' }))
            .toBe('hA6PB9 已知 1 2 x = 3，求 x 的值，并说明理…');
        expect(describeQuestion({ questionText: '' })).toBe('—');
    });
});

describe('按目标防重复（reserveBackgroundTask）', () => {
    const target = 'import-batch:abc:fix-text';

    it('同一用户同一 target 已有 running 任务时返回 null，同步调用两次只有一个成功', () => {
        const first = reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target });
        const second = reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target });
        expect(first).not.toBeNull();
        expect(second).toBeNull();
        expect(listBackgroundTasks('u1')).toHaveLength(1);
        expect(listBackgroundTasks('u1')[0].target).toBe(target);
    });

    it('不同用户、不同 target 互不影响', () => {
        expect(reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target })).not.toBeNull();
        expect(reserveBackgroundTask({ userId: 'u2', kind: 'fix_text', target })).not.toBeNull();
        expect(reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target: 'import-batch:other:fix-text' })).not.toBeNull();
        expect(listBackgroundTasks('u1')).toHaveLength(2);
    });

    it('cancel 后撤下预占，可再次预占，不留下记录', () => {
        const handle = reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target });
        expect(handle).not.toBeNull();
        handle!.cancel();
        expect(listBackgroundTasks('u1')).toHaveLength(0);
        expect(findRunningTask('u1', target)).toBeNull();
        expect(reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target })).not.toBeNull();
    });

    it('任务结束后可再次预占同一 target', async () => {
        const first = reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target });
        expect(first).not.toBeNull();
        await runReservedTask(first!, async () => 'ok');
        expect(findRunningTask('u1', target)).toBeNull();
        const second = reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target });
        expect(second).not.toBeNull();
        expect(second!.id).not.toBe(first!.id);
    });

    it('预占任务失败后可再次预占同一 target', async () => {
        const first = reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target });
        expect(first).not.toBeNull();
        await expect(runReservedTask(first!, async () => { throw new Error('AI_TIMEOUT_ERROR'); })).rejects.toThrow('AI_TIMEOUT_ERROR');
        expect(listBackgroundTasks('u1')[0]).toMatchObject({ status: 'failed', error: 'AI_TIMEOUT_ERROR' });
        expect(findRunningTask('u1', target)).toBeNull();
        expect(reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target })).not.toBeNull();
    });

    it('cancel 后 succeed/fail 不再生效', () => {
        const handle = reserveBackgroundTask({ userId: 'u1', kind: 'fix_text', target });
        expect(handle).not.toBeNull();
        handle!.cancel();
        handle!.succeed();
        expect(listBackgroundTasks('u1')).toHaveLength(0);
    });

    it('startBackgroundTask 与 trackBackgroundTask 也能带 target 并出现在列表中', () => {
        startBackgroundTask({ userId: 'u1', kind: 'fix_text', target: 'import-batch:x:fix-text' }).succeed();
        const listed = listBackgroundTasks('u1');
        expect(listed[0].target).toBe('import-batch:x:fix-text');
    });
});

describe('后台事务持久化', () => {
    let directory: string;
    let file: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-tasks-'));
        file = join(directory, 'background-tasks.json');
        resetBackgroundTasksForTest({ file });
    });
    afterEach(() => {
        resetBackgroundTasksForTest();
        rmSync(directory, { recursive: true, force: true });
    });

    it('重启后仍能看到已结束的事务，进行中的标记为因重启中断', async () => {
        const done = startBackgroundTask({ userId: 'u1', kind: 'reanswer', subject: '已完成' });
        done.succeed();
        const batch = startBackgroundTask({ userId: 'u1', kind: 'retag_notebook', subject: '进行中', total: 5 });
        batch.setProgress(2, 5, 0);
        flushBackgroundTasksForTest();

        // 模拟服务重启：内存清空后从文件重新读取
        resetBackgroundTasksForTest({ file });
        const tasks = listBackgroundTasks('u1');

        expect(tasks.find((t) => t.subject === '已完成')).toMatchObject({ status: 'succeeded', error: null });
        const interrupted = tasks.find((t) => t.subject === '进行中');
        expect(interrupted).toMatchObject({ status: 'failed', error: SERVER_RESTARTED, progress: { done: 2, total: 5, failed: 0 } });
        expect(interrupted?.finishedAt).not.toBeNull();
        expect(listBackgroundTasks('u2')).toEqual([]);
    });

    it('清除已结束的事务后写盘，重启后不再出现', () => {
        startBackgroundTask({ userId: 'u1', kind: 'reanswer' }).succeed();
        clearFinishedBackgroundTasks('u1');
        flushBackgroundTasksForTest();

        resetBackgroundTasksForTest({ file });
        expect(listBackgroundTasks('u1')).toEqual([]);
    });

    it('变化后延迟合并写盘', () => {
        vi.useFakeTimers();
        const task = startBackgroundTask({ userId: 'u1', kind: 'retag_notebook', total: 3 });
        task.setProgress(1);
        task.setProgress(2);
        expect(existsSync(file)).toBe(false);

        vi.advanceTimersByTime(1000);
        expect(JSON.parse(readFileSync(file, 'utf8'))[0]).toMatchObject({ userId: 'u1', progress: { done: 2, total: 3 } });
    });

    it('文件损坏或格式不对时忽略，不影响登记新事务', () => {
        writeFileSync(file, '{not json');
        resetBackgroundTasksForTest({ file });
        expect(listBackgroundTasks('u1')).toEqual([]);

        writeFileSync(file, JSON.stringify([{ id: 'x' }, 'bad', { id: 'ok', userId: 'u1', kind: 'reanswer', status: 'succeeded', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), subject: null, progress: null, error: null, link: null }]));
        resetBackgroundTasksForTest({ file });
        expect(listBackgroundTasks('u1').map((t) => t.id)).toEqual(['ok']);
    });

    it('超过保留时长的已结束事务在重启后被清理', () => {
        const old = new Date(Date.now() - FINISHED_TASK_TTL_MS - 1000).toISOString();
        writeFileSync(file, JSON.stringify([{ id: 'old', userId: 'u1', kind: 'reanswer', status: 'succeeded', startedAt: old, finishedAt: old, subject: null, progress: null, error: null, link: null }]));
        resetBackgroundTasksForTest({ file });
        expect(listBackgroundTasks('u1')).toEqual([]);
    });
});

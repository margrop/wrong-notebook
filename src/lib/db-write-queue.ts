/**
 * 进程内数据库写入队列（SQLite）。
 *
 * SQLite 同一时刻只有一个写事务。Prisma 查询引擎在少量工作线程（约等于 CPU 核数）上同步执行 SQLite 语句，
 * 等待写锁的语句会在 busy_timeout 内占住线程：若多个后台任务同时做单条写入，而另一个交互事务正持有写锁，
 * 等锁的语句可能占满全部工作线程，持锁事务拿不到线程执行下一条语句或提交，互相等待直到超时（P1008），
 * 核数少的机器（CI、NAS、低配服务器）上尤其明显。
 *
 * 识别导入与多题批次的写入都经由本队列串行提交：同一时刻只有一个写操作在等锁或持锁，读操作和 AI 调用不受影响。
 * 注意：队列中的操作内不能再次调用 serializeWrite / runSerializedTransaction（会等待自己而卡住），只包裹最底层的数据库调用。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

let queue: Promise<unknown> = Promise.resolve();

/** 按顺序执行一个数据库写操作（单条语句或一组不含交互事务的写入） */
export function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation);
    queue = run.catch(() => undefined);
    return run;
}

function isRetryableWriteConflict(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : String(error);
    return code === 'P2034' || code === 'P1008' || /database is locked|SQLITE_BUSY/i.test(message);
}

/**
 * 在写入队列中执行交互事务；遇到写锁冲突时整体回滚后重试（最多 3 次）。
 * 事务内只能使用传入的 tx，不能调用全局 prisma 写入。
 */
export function runSerializedTransaction<T>(operation: (client: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return serializeWrite(async () => {
        for (let attempt = 0; ; attempt++) {
            try {
                return await prisma.$transaction(operation, { maxWait: 10000, timeout: 30000 });
            } catch (error) {
                if (attempt >= 2 || !isRetryableWriteConflict(error)) throw error;
            }
        }
    });
}

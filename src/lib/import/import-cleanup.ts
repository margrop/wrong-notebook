/**
 * 识别任务与多题批次的保留期清理。
 *
 * 已保存的任务保留 7 天：入库后清空了图片，记录只用于展示「已导入」。待校对与失败的任务
 * 一直保留到用户处理或丢弃，不在自动清理范围内。
 *
 * 清理不依赖用户打开识别任务页：服务端启动后先清理一次，之后每 6 小时一次，
 * 因此长期无人访问时堆积的过期记录也会被清掉。识别任务列表接口复用同一套条件，
 * 保证用户看到的就是实际保留的数据。
 */

import "server-only";

import { createLogger } from "@/lib/logger";
import { serializeWrite } from "@/lib/db-write-queue";
import { prisma } from "@/lib/prisma";
import { SAVED_IMPORT_TASK_RETENTION_DAYS } from "@/lib/import/import-task-types";

const logger = createLogger('import-cleanup');

const DAY_MS = 24 * 60 * 60 * 1000;
/** 定时清理的间隔：6 小时，与遥测清理一致 */
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 启动后先等一分钟，避开启动时的迁移与初始化 */
const FIRST_PURGE_DELAY_MS = 60 * 1000;

const scheduler = globalThis as typeof globalThis & { __importCleanupStarted?: boolean };

/**
 * 删除超过保留期的已保存任务，以及因此变空的批次。
 * userId 为空时清理所有用户（定时任务）；给出时只清理该用户（列表请求）。
 * 返回删除的任务数与批次数。
 *
 * 按任务自身的结束时间判断保留期（finishedAt 为空时回退 updatedAt），
 * 批次内的任务不再等整批处理完才过期；批次里还有待校对、失败或执行中的任务时保留。
 */
export async function purgeImportTasks(now = new Date(), userId?: string): Promise<{ tasks: number; batches: number }> {
  const cutoff = new Date(now.getTime() - SAVED_IMPORT_TASK_RETENTION_DAYS * DAY_MS);
  const expired = {
    ...(userId ? { userId } : {}),
    status: 'saved',
    OR: [
      { finishedAt: { lt: cutoff } },
      { finishedAt: null, updatedAt: { lt: cutoff } },
    ],
  };
  try {
    return await serializeWrite(async () => {
      // 先删任务，再删已没有任务的批次；没有 userId 时不跨用户批量删除批次
      const tasks = await prisma.importTask.deleteMany({ where: expired });
      if (!userId) return { tasks: tasks.count, batches: 0 };
      const batches = await prisma.importBatch.deleteMany({ where: { userId, tasks: { none: {} } } });
      return { tasks: tasks.count, batches: batches.count };
    });
  } catch (error) {
    logger.warn({ error, userId }, 'Failed to purge expired import tasks');
    return { tasks: 0, batches: 0 };
  }
}

/** 常驻进程中启动导入任务的定期清理：启动一分钟后清理一次，之后每 6 小时一次 */
export function startImportCleanupScheduler(): void {
  if (scheduler.__importCleanupStarted) return;
  scheduler.__importCleanupStarted = true;
  const purge = () => {
    void purgeImportTasks().then(({ tasks }) => {
      if (tasks > 0) logger.info({ tasks }, 'Purged expired import tasks');
    }).catch(() => undefined);
  };
  setTimeout(() => {
    purge();
    setInterval(purge, PURGE_INTERVAL_MS).unref();
  }, FIRST_PURGE_DELAY_MS).unref();
}

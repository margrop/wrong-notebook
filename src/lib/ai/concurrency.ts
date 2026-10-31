/**
 * AI 模型调用并发限制：同一模型（同一渠道、地址和模型名）同时进行的调用不超过上限，
 * 超出的调用按先来后到排队，避免触发服务商的 429 限流。
 * 上限每次取号时从配置读取，管理员修改后对之后的排队立即生效。
 */

import { parseConcurrencyLimit } from '../ai-concurrency-limit';
import { getAppConfig } from '../config';
import { createLogger } from '../logger';

const logger = createLogger('ai:concurrency');

interface ModelQueue {
    active: number;
    waiting: Array<() => void>;
}

const queues = new Map<string, ModelQueue>();

function getLimit(): number {
    try {
        return parseConcurrencyLimit(getAppConfig().aiConcurrencyLimit);
    } catch {
        // 读取配置失败（或测试中模拟的配置模块未提供）时使用默认上限
        return parseConcurrencyLimit(undefined);
    }
}

/** 在空位允许时依次放行排队的调用 */
function dispatch(key: string, queue: ModelQueue): void {
    const limit = getLimit();
    while (queue.active < limit && queue.waiting.length > 0) {
        queue.active += 1;
        queue.waiting.shift()?.();
    }
    if (queue.active === 0 && queue.waiting.length === 0) queues.delete(key);
}

/** 取得一个调用名额，超出上限时排队等待 */
function acquire(key: string): Promise<void> {
    let queue = queues.get(key);
    if (!queue) {
        queue = { active: 0, waiting: [] };
        queues.set(key, queue);
    }
    if (queue.active < getLimit() && queue.waiting.length === 0) {
        queue.active += 1;
        return Promise.resolve();
    }
    logger.info({ model: key, active: queue.active, waiting: queue.waiting.length + 1 }, 'AI call queued by concurrency limit');
    const current = queue;
    return new Promise<void>((resolve) => current.waiting.push(resolve));
}

function release(key: string): void {
    const queue = queues.get(key);
    if (!queue) return;
    queue.active = Math.max(0, queue.active - 1);
    dispatch(key, queue);
}

/** 在模型的并发上限内执行一次 AI 调用 */
export async function runWithModelConcurrency<T>(key: string, task: () => Promise<T>): Promise<T> {
    await acquire(key);
    try {
        return await task();
    } finally {
        release(key);
    }
}

/** 当前各模型的进行中和排队数量（用于日志与测试） */
export function getModelConcurrencyState(key: string): { active: number; waiting: number } {
    const queue = queues.get(key);
    return { active: queue?.active ?? 0, waiting: queue?.waiting.length ?? 0 };
}

/**
 * 包装 AI 服务：每个方法调用都受同一模型的并发上限约束。
 * 方法内部通过 this 调用的其他方法不再重复排队，避免互相等待。
 */
export function limitModelConcurrency<T extends object>(service: T, key: string): T {
    return new Proxy(service, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function' || prop === 'constructor') return value;
            return (...args: unknown[]) => runWithModelConcurrency(key, () => Promise.resolve(value.apply(target, args)));
        },
    });
}

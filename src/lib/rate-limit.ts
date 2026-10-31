/**
 * 进程内的失败次数限流，用于登录、注册等容易被暴力尝试的入口。
 *
 * 生产环境是单个容器，计数保存在内存即可；重启后清零只会放宽限制，不会误锁用户。
 */

export interface RateLimitRule {
    /** 统计窗口内允许的最大次数 */
    limit: number;
    /** 统计窗口（毫秒），超过次数后也按这个时长锁定 */
    windowMs: number;
}

interface Bucket {
    count: number;
    resetAt: number;
}

/** 防止被大量不同的 key 撑爆内存 */
const MAX_BUCKETS = 10_000;

export class RateLimiter {
    private readonly buckets = new Map<string, Bucket>();

    constructor(private readonly rule: RateLimitRule, private readonly now: () => number = Date.now) {}

    /** 返回还需等待的毫秒数；为 0 表示未超限 */
    retryAfter(key: string): number {
        const bucket = this.current(key);
        if (!bucket || bucket.count < this.rule.limit) return 0;
        return bucket.resetAt - this.now();
    }

    /** 记一次（失败或请求），返回记完后是否已超限 */
    hit(key: string): boolean {
        const bucket = this.current(key);
        if (bucket) {
            bucket.count += 1;
            return bucket.count >= this.rule.limit;
        }
        if (this.buckets.size >= MAX_BUCKETS) this.prune();
        this.buckets.set(key, { count: 1, resetAt: this.now() + this.rule.windowMs });
        return this.rule.limit <= 1;
    }

    reset(key: string): void {
        this.buckets.delete(key);
    }

    private current(key: string): Bucket | undefined {
        const bucket = this.buckets.get(key);
        if (bucket && bucket.resetAt <= this.now()) {
            this.buckets.delete(key);
            return undefined;
        }
        return bucket;
    }

    private prune(): void {
        const now = this.now();
        for (const [key, bucket] of this.buckets) {
            if (bucket.resetAt <= now) this.buckets.delete(key);
        }
        // 仍然太多时丢弃最早的一批，宁可放宽也不无限增长
        if (this.buckets.size >= MAX_BUCKETS) {
            const drop = Math.ceil(MAX_BUCKETS / 10);
            let i = 0;
            for (const key of this.buckets.keys()) {
                if (i++ >= drop) break;
                this.buckets.delete(key);
            }
        }
    }
}

type HeaderSource = Headers | Record<string, string | string[] | undefined> | undefined;

function readHeader(headers: HeaderSource, name: string): string | undefined {
    if (!headers) return undefined;
    if (typeof (headers as Headers).get === "function") {
        return (headers as Headers).get(name) ?? undefined;
    }
    const value = (headers as Record<string, string | string[] | undefined>)[name];
    return Array.isArray(value) ? value[0] : value;
}

/** 取客户端 IP：依次看 Cloudflare、反向代理头，取不到时归为 unknown */
export function getClientIp(headers: HeaderSource): string {
    const candidates = [
        readHeader(headers, "cf-connecting-ip"),
        readHeader(headers, "x-real-ip"),
        readHeader(headers, "x-forwarded-for")?.split(",")[0],
    ];
    for (const value of candidates) {
        const ip = value?.trim();
        if (ip) return ip;
    }
    return "unknown";
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** 同一账号 15 分钟内密码错 5 次即锁定 15 分钟 */
export const loginAccountLimiter = new RateLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES });
/** 同一 IP 15 分钟内登录失败 20 次即锁定，防止换着账号试 */
export const loginIpLimiter = new RateLimiter({ limit: 20, windowMs: FIFTEEN_MINUTES });
/** 同一 IP 每小时最多提交 10 次注册或初始化 */
export const registerIpLimiter = new RateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });

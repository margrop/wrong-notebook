import { prisma } from "@/lib/prisma";
import { getAIService } from "@/lib/ai";
import { createLogger } from "@/lib/logger";
import { DEFAULT_MASTERY_THRESHOLD, isMastered, masteryLevelOf, masteryStatusWhere } from "@/lib/mastery-status";
import type { MasteryStatus } from "@/lib/mastery-status";
import type { Prisma } from "@prisma/client";
import type { MasteryHistoryEntry, PracticeResult } from "@/lib/ai/types";

const logger = createLogger('mastery');

export { DEFAULT_MASTERY_THRESHOLD };

export const PRACTICE_RESULTS: readonly PracticeResult[] = ['correct', 'wrong', 'not_attempted'];

export function isPracticeResult(value: unknown): value is PracticeResult {
    return typeof value === 'string' && (PRACTICE_RESULTS as readonly string[]).includes(value);
}

// 做对时按难度给分：难度越高越能说明掌握
const CORRECT_SCORE: Record<string, number> = { easy: 0.85, medium: 0.95, hard: 1, harder: 1 };
const RESULT_SCORE: Record<Exclude<PracticeResult, 'correct'>, number> = { wrong: 0.1, not_attempted: 0 };
// 每往前一次，权重乘以该系数
const RECENCY_DECAY = 0.7;
// 先验：没有足够记录时向 PRIOR 收缩
const PRIOR = 0.3;
const PRIOR_WEIGHT = 0.5;

/**
 * 规则公式估算掌握概率（0~1），记录按时间从早到晚排列；无记录返回 null
 */
export function computeRuleMastery(history: Pick<MasteryHistoryEntry, 'result' | 'difficulty'>[]): number | null {
    if (history.length === 0) {
        return null;
    }
    let weightedSum = PRIOR * PRIOR_WEIGHT;
    let weightTotal = PRIOR_WEIGHT;
    history.forEach((entry, index) => {
        const weight = Math.pow(RECENCY_DECAY, history.length - 1 - index);
        const score = entry.result === 'correct'
            ? CORRECT_SCORE[entry.difficulty || 'medium'] ?? CORRECT_SCORE.medium
            : RESULT_SCORE[entry.result];
        weightedSum += weight * score;
        weightTotal += weight;
    });
    return Math.round((weightedSum / weightTotal) * 100) / 100;
}

/** 有举一反三记录时的 masteryLevel：1 复习中，2 已掌握 */
export function masteryLevelFor(probability: number, threshold = DEFAULT_MASTERY_THRESHOLD): number {
    return masteryLevelOf(isMastered(probability, threshold) ? 'mastered' : 'reviewing');
}

/** 读取用户的已掌握阈值（百分比），用户不存在时返回默认值 */
export async function getMasteryThreshold(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { masteryThreshold: true } });
    return user?.masteryThreshold ?? DEFAULT_MASTERY_THRESHOLD;
}

/** 阈值变化后按新阈值同步用户错题的 masteryLevel；只更新状态改变的错题，避免无关错题的 updatedAt 被刷新 */
export function syncMasteryLevels(client: Prisma.TransactionClient, userId: string, threshold: number) {
    return Promise.all((['reviewing', 'mastered'] as const).map((status) =>
        client.errorItem.updateMany({
            where: { AND: [{ userId, masteryLevel: { not: masteryLevelOf(status) } }, masteryStatusWhere(status, threshold)] },
            data: { masteryLevel: masteryLevelOf(status) },
        })));
}

/**
 * 重新评估一道错题的掌握概率：优先调用 AI，失败时使用规则公式兜底
 */
export async function evaluateErrorItemMastery(errorItemId: string): Promise<void> {
    const item = await prisma.errorItem.findUnique({
        where: { id: errorItemId },
        select: {
            id: true,
            userId: true,
            questionText: true,
            mistakeStatus: true,
            user: { select: { masteryThreshold: true, aiDataConsentAt: true } },
            tags: { select: { name: true } },
            practiceRecords: {
                where: { result: { not: null } },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                select: { result: true, difficulty: true, source: true, createdAt: true },
            },
        },
    });
    if (!item) {
        return;
    }

    const history: MasteryHistoryEntry[] = item.practiceRecords
        .filter((record) => isPracticeResult(record.result))
        .map((record) => ({
            date: record.createdAt.toISOString(),
            difficulty: record.difficulty,
            result: record.result as PracticeResult,
            source: record.source,
        }));

    const ruleProbability = computeRuleMastery(history);
    if (ruleProbability === null) {
        await prisma.errorItem.update({
            where: { id: item.id },
            data: { masteryProbability: null, masteryReason: null, masterySource: null, masteryEvaluatedAt: null, masteryLevel: masteryLevelOf('new') },
        });
        return;
    }

    const evaluatedAt = new Date();
    let probability = ruleProbability;
    let reason = '';
    let source: 'ai' | 'rule' = 'rule';
    try {
        // 用户未同意 AI 数据授权时不把题目发给 AI，直接按规则估算
        if (!item.user?.aiDataConsentAt) throw new Error('AI_CONSENT_REQUIRED');
        const ai = await getAIService({ userId: item.userId, kind: 'mastery' });
        const result = await ai.evaluateMastery({
            questionText: item.questionText || '',
            knowledgePoints: item.tags.map((tag) => tag.name),
            mistakeStatus: item.mistakeStatus,
            history,
            ruleProbability,
            evaluatedAt: evaluatedAt.toISOString(),
        });
        probability = result.probability;
        reason = result.reason;
        source = 'ai';
    } catch (error) {
        logger.warn({ errorItemId, error: error instanceof Error ? error.message : String(error) }, 'AI mastery evaluation failed, using rule estimate');
        const correct = history.filter((entry) => entry.result === 'correct').length;
        reason = `共练习 ${history.length} 次，做对 ${correct} 次（规则估算）`;
    }

    await prisma.errorItem.update({
        where: { id: item.id },
        data: {
            masteryProbability: probability,
            masteryReason: reason,
            masterySource: source,
            masteryEvaluatedAt: evaluatedAt,
            masteryLevel: masteryLevelFor(probability, item.user.masteryThreshold),
        },
    });
    logger.info({ errorItemId, probability, source }, 'Mastery evaluated');
}

/** 按复习状态统计错题数量；不同用户的阈值可能不同，按阈值分组统计后汇总 */
export async function countByMasteryStatus(where: Prisma.ErrorItemWhereInput = {}): Promise<Record<MasteryStatus, number>> {
    const thresholds = await prisma.user.findMany({ distinct: ['masteryThreshold'], select: { masteryThreshold: true } });
    const results = await Promise.all(thresholds.flatMap(({ masteryThreshold }) =>
        (['new', 'reviewing', 'mastered'] as const).map(async (status) => ({
            status,
            count: await prisma.errorItem.count({
                where: { AND: [where, { user: { masteryThreshold } }, masteryStatusWhere(status, masteryThreshold)] },
            }),
        }))));
    const counts: Record<MasteryStatus, number> = { new: 0, reviewing: 0, mastered: 0 };
    results.forEach(({ status, count }) => { counts[status] += count; });
    return counts;
}

// 后台评估队列：串行执行，同一题重复入队时只评估一次
const pendingIds = new Set<string>();
let running = false;

async function drainQueue(): Promise<void> {
    if (running) return;
    running = true;
    try {
        while (pendingIds.size > 0) {
            const [id] = pendingIds;
            pendingIds.delete(id);
            try {
                await evaluateErrorItemMastery(id);
            } catch (error) {
                logger.error({ errorItemId: id, error }, 'Mastery evaluation failed');
            }
        }
    } finally {
        running = false;
    }
}

/** 将错题加入后台评估队列，不阻塞当前请求 */
export function scheduleMasteryEvaluation(errorItemIds: string[]): void {
    errorItemIds.forEach((id) => pendingIds.add(id));
    void drainQueue();
}

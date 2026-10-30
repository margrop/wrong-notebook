/**
 * 后台耗时事务登记：识别题目、生成动画讲解、重新解题、批量标注、生成试卷等调用 AI 的操作
 * 开始时登记，结束时标记成功或失败，供页面「后台任务」弹框查询进度。
 *
 * 只保存在当前进程内存中（生产环境为单个容器）；服务重启后列表清空，已完成的事务保留一段时间后自动清理。
 */
import { createLogger } from "@/lib/logger";

const logger = createLogger('background-tasks');

export type BackgroundTaskKind =
    | 'analyze'          // 识别题目图片
    | 'batch_upload'     // Openclaw 批量上传识别
    | 'data_import'      // 导入备份数据
    | 'svg_animation'    // 生成 SVG 动画讲解
    | 'svg_narration'    // 补写动画的语音讲解稿
    | 'tts_voice'        // 合成动画讲解的云端语音
    | 'reanswer'         // 重新生成解答
    | 'fix_latex'        // 修复 LaTeX
    | 'figure'           // 重绘配图
    | 'geogebra'         // 生成 GeoGebra 演示
    | 'retag'            // 重新生成知识点（单题）
    | 'retag_notebook'   // 错题本批量重新生成知识点
    | 'practice'         // 生成举一反三题目
    | 'exam';            // 生成试卷

export type BackgroundTaskStatus = 'running' | 'succeeded' | 'failed';

export interface BackgroundTask {
    id: string;
    kind: BackgroundTaskKind;
    /** 操作对象的说明，如题目编号和题干开头、错题本名、试卷标题 */
    subject: string | null;
    status: BackgroundTaskStatus;
    /** 批量事务的进度 */
    progress: { done: number; total: number; failed: number } | null;
    error: string | null;
    /** 可跳转查看的页面 */
    link: string | null;
    startedAt: string;
    finishedAt: string | null;
}

interface StoredTask extends BackgroundTask {
    userId: string;
}

export interface BackgroundTaskInput {
    userId: string;
    kind: BackgroundTaskKind;
    subject?: string | null;
    link?: string | null;
    total?: number;
}

export interface BackgroundTaskHandle {
    id: string;
    setProgress: (done: number, total?: number, failed?: number) => void;
    succeed: () => void;
    fail: (error: unknown) => void;
}

/** 已结束的事务保留时长 */
export const FINISHED_TASK_TTL_MS = 30 * 60 * 1000;
/** 每个用户最多保留的已结束事务数 */
const MAX_FINISHED_PER_USER = 30;

// 开发环境热更新会重新加载模块，挂在 globalThis 上保持同一份登记表
const store = globalThis as typeof globalThis & { __backgroundTasks?: Map<string, StoredTask> };
const tasks: Map<string, StoredTask> = store.__backgroundTasks ??= new Map();

let sequence = 0;

function prune(now: number) {
    for (const [id, task] of tasks) {
        if (task.finishedAt && now - Date.parse(task.finishedAt) > FINISHED_TASK_TTL_MS) tasks.delete(id);
    }
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    // AI 错误码形如 AI_RESPONSE_ERROR: 详情，只保留错误码交给前端翻译
    return (message.startsWith('AI_') ? message.split(':')[0] : message).slice(0, 200);
}

/** 登记一个后台事务 */
export function startBackgroundTask(input: BackgroundTaskInput): BackgroundTaskHandle {
    const now = Date.now();
    prune(now);
    const id = `${now.toString(36)}-${(sequence++).toString(36)}`;
    const task: StoredTask = {
        id,
        userId: input.userId,
        kind: input.kind,
        subject: input.subject ?? null,
        status: 'running',
        progress: input.total !== undefined ? { done: 0, total: input.total, failed: 0 } : null,
        error: null,
        link: input.link ?? null,
        startedAt: new Date(now).toISOString(),
        finishedAt: null,
    };
    tasks.set(id, task);

    const finish = (status: BackgroundTaskStatus, error: string | null) => {
        if (task.status !== 'running') return;
        task.status = status;
        task.error = error;
        task.finishedAt = new Date().toISOString();
    };
    return {
        id,
        setProgress: (done, total, failed) => {
            task.progress = { done, total: total ?? task.progress?.total ?? done, failed: failed ?? task.progress?.failed ?? 0 };
        },
        succeed: () => finish('succeeded', null),
        fail: (error) => {
            finish('failed', errorMessage(error));
            logger.debug({ taskId: id, kind: task.kind, error: task.error }, 'Background task failed');
        },
    };
}

/**
 * 登记事务并执行 operation：正常返回标记成功，抛错标记失败后继续抛出
 */
export async function trackBackgroundTask<T>(input: BackgroundTaskInput, operation: (task: BackgroundTaskHandle) => Promise<T>): Promise<T> {
    const task = startBackgroundTask(input);
    try {
        const result = await operation(task);
        task.succeed();
        return result;
    } catch (error) {
        task.fail(error);
        throw error;
    }
}

/**
 * 当前用户的事务：进行中的在前（按开始时间），其后是最近结束的
 */
export function listBackgroundTasks(userId: string): BackgroundTask[] {
    prune(Date.now());
    const own = [...tasks.values()].filter((task) => task.userId === userId);
    const running = own.filter((task) => task.status === 'running')
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const finished = own.filter((task) => task.status !== 'running')
        .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
        .slice(0, MAX_FINISHED_PER_USER);
    return [...running, ...finished].map((task) => ({
        id: task.id,
        kind: task.kind,
        subject: task.subject,
        status: task.status,
        progress: task.progress && { ...task.progress },
        error: task.error,
        link: task.link,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
    }));
}

/** 清除当前用户已结束的事务记录 */
export function clearFinishedBackgroundTasks(userId: string): void {
    for (const [id, task] of tasks) {
        if (task.userId === userId && task.status !== 'running') tasks.delete(id);
    }
}

/** 题目的简短说明：编号 + 题干开头（去掉公式符号和换行） */
export function describeQuestion(item: { shortId?: string | null; questionText?: string | null }): string {
    const text = (item.questionText ?? '')
        .replace(/\$+/g, '')
        .replace(/\\[a-zA-Z]+|[{}\\]/g, ' ')
        .replace(/[#*>`|_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s*([，。；：？！、])\s*/g, '$1')
        .trim();
    const excerpt = text.length > 24 ? `${text.slice(0, 24)}…` : text;
    return [item.shortId, excerpt].filter(Boolean).join(' ') || '—';
}

/** 仅供测试：清空登记表 */
export function resetBackgroundTasksForTest(): void {
    tasks.clear();
}

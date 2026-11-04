/**
 * 组卷选题来源（provider）扩展点。
 *
 * 上游默认只注册 "error-items"（从错题本按掌握情况与抽题规则选题）。
 * fork 项目（如 AI 题库）可注册自己的 provider，复用后续的出题、打印、成绩记录流程。
 */
import { selectSourceItems } from "@/lib/exam/exam";
import type { ExamSelection } from "@/lib/exam/exam";

/** selectSourceItems 的返回类型：选出的原题列表 */
export type ExamSourceItems = Awaited<ReturnType<typeof selectSourceItems>>;

export interface ExamSourceProvider {
    /** 唯一标识；小写字母数字与短横线 */
    key: string;
    /** 按 fork 项目自己的规则选题，返回与默认实现相同结构的原题列表 */
    select(userId: string, selection: ExamSelection): Promise<ExamSourceItems>;
}

/** 默认选题来源 key */
export const DEFAULT_EXAM_SOURCE = 'error-items';

const providers = new Map<string, ExamSourceProvider>();

/** 注册选题来源；重复注册同 key 会覆盖，测试结束应调用 unregisterExamSourceProvider 注销 */
export function registerExamSourceProvider(provider: ExamSourceProvider): void {
    providers.set(provider.key, provider);
}

/** 注销选题来源（主要用于测试清理） */
export function unregisterExamSourceProvider(key: string): void {
    providers.delete(key);
}

/** 按 key 获取选题来源；未注册返回 undefined */
export function getExamSourceProvider(key: string): ExamSourceProvider | undefined {
    return providers.get(key);
}

// 上游默认实现：从错题本选题
registerExamSourceProvider({ key: DEFAULT_EXAM_SOURCE, select: selectSourceItems });

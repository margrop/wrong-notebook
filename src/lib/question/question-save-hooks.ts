/**
 * 题目保存全局钩子：fork 项目在题目入库时同步写自己的数据。
 *
 * 钩子在错题写入的同一数据库事务内、options.afterWrite 之后依次执行；
 * 任何钩子抛错都会使整笔事务回滚（与 afterWrite 一致），并记录 logger.error。
 *
 * 注意：钩子在事务内运行，执行时间直接拉长事务持有时间，
 * 不要在钩子里调用外部网络或执行耗时计算，只做同库的数据写入。
 */
import type { Prisma } from "@prisma/client";
import type { ImportQuestionInput } from "@/lib/question/question-save";

/** 题目入库的来源路径 */
export type QuestionSaveOrigin =
    /** 单题保存 API（「添加错题」页面/接口，src/app/api/error-items/route.ts） */
    | 'manual'
    /** 识别导入任务（拍照/文字识别后的自动或人工确认入库，src/lib/import/import-tasks.ts） */
    | 'import-task'
    /** Openclaw 批量上传（src/app/api/openclaw/batch-upload/route.ts） */
    | 'openclaw';

/** 题目保存事件：钩子在同一事务内收到写入结果与原始输入 */
export interface QuestionSaveEvent {
    userId: string;
    errorItemId: string;
    /** 本次保存被判为重复题（仅记录做错历史，未新建错题） */
    duplicate: boolean;
    origin: QuestionSaveOrigin;
    input: ImportQuestionInput;
}

export type QuestionSaveHook = (tx: Prisma.TransactionClient, event: QuestionSaveEvent) => Promise<void>;

/** 已注册的全局钩子列表（按注册顺序执行） */
export const QUESTION_SAVE_HOOKS: QuestionSaveHook[] = [];

/** 注册一个题目保存钩子；返回取消注册函数 */
export function registerQuestionSaveHook(hook: QuestionSaveHook): () => void {
    QUESTION_SAVE_HOOKS.push(hook);
    return () => {
        const index = QUESTION_SAVE_HOOKS.indexOf(hook);
        if (index >= 0) QUESTION_SAVE_HOOKS.splice(index, 1);
    };
}

/** 仅供测试：清空所有已注册的全局钩子 */
export function clearQuestionSaveHooksForTest(): void {
    QUESTION_SAVE_HOOKS.length = 0;
}

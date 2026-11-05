import type { QuestionType } from "@/lib/question/question-type";
import { prisma } from "@/lib/prisma";
import { getAIService } from "@/lib/ai";
import type { AiCallScope } from "@/lib/ai";
import { getMathTagsFromDB, getScopeTagsFromDB } from "@/lib/ai/tag-service";
import { calculateGradeNumber } from "@/lib/tags/knowledge-tags";
import { calculateGrade } from "@/lib/grade-calculator";
import { resolveNotebookScope, SUBJECT_DISPLAY_NAMES } from "@/lib/notebook-scope";
import { createLogger } from "@/lib/logger";
import { getDefaultPaperLevelGroupId } from "@/lib/paper-level";
import { getAppTimeZone } from "@/lib/config";
import { startBackgroundTask } from "@/lib/background-tasks";
import type { BackgroundTaskHandle } from "@/lib/background-tasks";

const logger = createLogger('retag');

// 批量重新标注时同时处理的题目数
const CONCURRENCY = 2;

export interface RetagResult {
    errorItemId: string;
    tags: string[];
    difficultyStars: number | null; // AI 评定的难度星级，未给出时为空
    /** AI 判断的题型；只在题目当前题型为空时返回，已有题型不覆盖 */
    questionType: QuestionType | null;
}

interface TagSuggestion {
    tagNames: string[];                  // 新系统标签 + 保留的自定义标签
    difficultyStars: number | null;
    questionType: QuestionType | null;
    paperLevel: string | null;
    newTagIds: string[];
    oldSystemTags: { id: string; name: string }[];
}

/**
 * 可复用的标签建议入参：题目文本、答案解析与可选知识点范围
 */
export interface SuggestTagsForTextInput {
    questionText: string;
    answerText?: string | null;
    analysis?: string | null;
    wrongAnswerText?: string | null;
    mistakeAnalysis?: string | null;
    /** 目标错题本的学段/学科/标签体系/名称；为空时按数学处理 */
    notebook?: { stage: string | null; subjectKey: string | null; tagSet: string | null; name: string } | null;
    /** 用户年级信息（未提供错题本学科时按数学标签需要） */
    user?: { educationStage: string | null; enrollmentYear: number | null } | null;
    gradeSemester?: string | null;
    /** AI 用量记入的用户和操作 */
    aiScope: AiCallScope;
}

/**
 * 可复用的标签建议出参
 */
export interface SuggestTagsForTextResult {
    tags: string[];
    difficultyStars: number | null;
    questionType: QuestionType | null;
}

/**
 * 基于题目文本、答案解析与可选知识点范围，调用 AI 选出知识点、评定难度与题型（可复用）
 */
export async function suggestTagsForText(input: SuggestTagsForTextInput): Promise<SuggestTagsForTextResult> {
    // 候选知识点 = 错题本学段 + 学科 + 标签体系下的全部标签；
    // 不在错题本中或错题本学科未知时按数学处理，并按学生年级取标签（与识别时的默认行为一致）
    const scope = input.notebook ? resolveNotebookScope({ stage: input.notebook.stage, subjectKey: input.notebook.subjectKey, name: input.notebook.name ?? '' }) : null;
    const subjectKey = scope?.subject || 'math';
    const itemTagSet = input.notebook?.tagSet || 'default';
    const allowedTags = scope?.subject
        ? await getScopeTagsFromDB(scope.subject, scope.stage, itemTagSet)
        : await getMathTagsFromDB(calculateGradeNumber(input.user?.educationStage ?? null, input.user?.enrollmentYear ?? null, getAppTimeZone()));
    if (allowedTags.length === 0) {
        throw new Error('NO_AVAILABLE_TAGS');
    }

    const gradeSemester = input.gradeSemester
        || (input.user?.educationStage && input.user?.enrollmentYear
            ? calculateGrade(input.user.educationStage, input.user.enrollmentYear, new Date(), 'zh', getAppTimeZone())
            : null);

    const ai = await getAIService(input.aiScope);
    const { tags: chosen, difficultyStars, questionType } = await ai.suggestKnowledgeTags({
        questionText: input.questionText,
        answerText: input.answerText,
        analysis: input.analysis,
        wrongAnswerText: input.wrongAnswerText,
        mistakeAnalysis: input.mistakeAnalysis,
        subject: SUBJECT_DISPLAY_NAMES[subjectKey],
        allowedTags,
        gradeSemester,
    });
    if (chosen.length === 0) {
        throw new Error('NO_TAGS_SELECTED');
    }
    return { tags: chosen, difficultyStars, questionType };
}

/**
 * 用 AI 从当前知识点库中为一道错题选取知识点并评定难度星级（不保存）：题目与解答过程一并交给 AI；系统标签换成 AI 选出的，保留自定义标签
 */
async function suggestTagsForItem(errorItemId: string, userId: string): Promise<TagSuggestion> {
    const item = await prisma.errorItem.findUnique({
        where: { id: errorItemId },
        select: {
            userId: true,
            questionText: true,
            answerText: true,
            analysis: true,
            wrongAnswerText: true,
            mistakeAnalysis: true,
            gradeSemester: true,
            paperLevel: true,
            questionType: true,
            subject: { select: { name: true, stage: true, subjectKey: true, tagSet: true } },
            tags: { select: { id: true, name: true, isSystem: true } },
            user: { select: { educationStage: true, enrollmentYear: true } },
        },
    });
    if (!item || item.userId !== userId) {
        throw new Error('ITEM_NOT_FOUND');
    }
    if (!item.questionText?.trim()) {
        throw new Error('NO_QUESTION_TEXT');
    }

    const { tags: chosen, difficultyStars, questionType } = await suggestTagsForText({
        questionText: item.questionText,
        answerText: item.answerText,
        analysis: item.analysis,
        wrongAnswerText: item.wrongAnswerText,
        mistakeAnalysis: item.mistakeAnalysis,
        notebook: item.subject,
        user: item.user,
        gradeSemester: item.gradeSemester,
        aiScope: { userId, kind: 'retag' },
    });

    // 候选知识点 = 错题本学段 + 学科 + 标签体系下的全部标签；
    // 不在错题本中或错题本学科未知时按数学处理，并按学生年级取标签（与识别时的默认行为一致）
    const scope = item.subject ? resolveNotebookScope(item.subject) : null;
    const subjectKey = scope?.subject || 'math';
    const itemTagSet = item.subject?.tagSet || 'default';

    // 同名系统标签可能出现在多个年级或多个体系下，限定当前错题本的 tagSet，取第一个即可
    const systemTags = await prisma.knowledgeTag.findMany({
        where: { isSystem: true, subject: subjectKey, tagSet: itemTagSet, name: { in: chosen } },
        select: { id: true, name: true },
    });
    const tagIdByName = new Map<string, string>();
    for (const tag of systemTags) {
        if (!tagIdByName.has(tag.name)) tagIdByName.set(tag.name, tag.id);
    }
    const newTags = chosen.filter((name) => tagIdByName.has(name));
    const customTags = item.tags.filter((tag) => !tag.isSystem);

    return {
        tagNames: [...newTags, ...customTags.map((tag) => tag.name).filter((name) => !newTags.includes(name))],
        difficultyStars,
        // 只在题目当前题型为空时写入 AI 判断的题型，已有题型不覆盖
        questionType: !item.questionType ? questionType : null,
        paperLevel: item.paperLevel,
        newTagIds: newTags.map((name) => tagIdByName.get(name)!),
        oldSystemTags: item.tags.filter((tag) => tag.isSystem).map(({ id, name }) => ({ id, name })),
    };
}

/**
 * 只返回 AI 建议的知识点、不保存，供编辑标签时预填
 */
export async function previewRetagErrorItem(errorItemId: string, userId: string): Promise<RetagResult> {
    const { tagNames, difficultyStars, questionType } = await suggestTagsForItem(errorItemId, userId);
    return { errorItemId, tags: tagNames, difficultyStars, questionType };
}

/**
 * 用 AI 从当前知识点库中为一道题重新选取知识点并评定难度星级后保存：替换原有系统标签，保留自定义标签；
 * AI 未给出星级时保留原星级；只在题目当前题型为空时写入 AI 判断的题型
 */
export async function retagErrorItem(errorItemId: string, userId: string): Promise<RetagResult> {
    const { tagNames, newTagIds, oldSystemTags, difficultyStars, questionType, paperLevel } = await suggestTagsForItem(errorItemId, userId);
    const defaultPaperLevel = !paperLevel ? await getDefaultPaperLevelGroupId(userId, difficultyStars) : null;

    await prisma.errorItem.update({
        where: { id: errorItemId },
        data: {
            knowledgePoints: JSON.stringify(tagNames),
            ...(difficultyStars !== null ? { difficultyStars } : {}),
            ...(questionType ? { questionType } : {}),
            ...(defaultPaperLevel ? { paperLevel: defaultPaperLevel } : {}),
            tags: {
                disconnect: oldSystemTags.map((tag) => ({ id: tag.id })),
                connect: newTagIds.map((id) => ({ id })),
            },
        },
    });

    logger.info({ errorItemId, before: oldSystemTags.map((tag) => tag.name), after: tagNames, difficultyStars, questionType }, 'Error item retagged');
    return { errorItemId, tags: tagNames, difficultyStars, questionType };
}

export interface RetagJobStatus {
    subjectId: string;
    total: number;
    done: number;
    failed: number;
    running: boolean;
    startedAt: string;
    finishedAt: string | null;
}

// 后台批量任务：按「用户 + 错题本」记录，进程重启后丢失（可重新发起）
const jobs = new Map<string, RetagJobStatus>();
const jobKey = (userId: string, subjectId: string) => `${userId}:${subjectId}`;

export function getRetagJob(userId: string, subjectId: string): RetagJobStatus | null {
    return jobs.get(jobKey(userId, subjectId)) ?? null;
}

/**
 * 在后台为错题本中的全部题目重新生成知识点；同一错题本已在运行时直接返回当前状态。
 *
 * taskHandle 为路由层用 reserveBackgroundTask 预占的句柄（按 target 防重复），
 * 传入时用它替代内部自建的后台任务登记，便于路由层在额度不足等场景统一 cancel。
 */
export async function startRetagJob(userId: string, subjectId: string, taskHandle?: BackgroundTaskHandle): Promise<RetagJobStatus> {
    const key = jobKey(userId, subjectId);
    const existing = jobs.get(key);
    if (existing?.running) {
        taskHandle?.cancel();
        return existing;
    }

    const items = await prisma.errorItem.findMany({
        where: { userId, subjectId },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
    });
    const status: RetagJobStatus = {
        subjectId,
        total: items.length,
        done: 0,
        failed: 0,
        running: items.length > 0,
        startedAt: new Date().toISOString(),
        finishedAt: items.length > 0 ? null : new Date().toISOString(),
    };
    jobs.set(key, status);

    const notebook = await prisma.subject.findUnique({ where: { id: subjectId }, select: { name: true } });
    const task = taskHandle ?? startBackgroundTask({ userId, kind: 'retag_notebook', subject: notebook?.name ?? null, link: `/notebooks/${subjectId}`, total: items.length });
    if (items.length === 0) {
        // 空错题本：没有需要执行的工作，立即成功结束
        task.succeed();
    }

    const queue = items.map((item) => item.id);
    const worker = async () => {
        while (queue.length > 0) {
            const id = queue.shift()!;
            try {
                await retagErrorItem(id, userId);
            } catch (error) {
                status.failed++;
                logger.warn({ errorItemId: id, error: error instanceof Error ? error.message : String(error) }, 'Retag failed');
            } finally {
                status.done++;
                task.setProgress(status.done, status.total, status.failed);
            }
        }
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)).finally(() => {
        status.running = false;
        status.finishedAt = new Date().toISOString();
        if (status.total > 0 && status.failed === status.total) task.fail('ALL_FAILED');
        else task.succeed();
        logger.info({ subjectId, total: status.total, failed: status.failed }, 'Retag job finished');
    });

    return status;
}

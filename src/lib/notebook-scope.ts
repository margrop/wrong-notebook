/**
 * 错题本的学段与学科（仅在创建时设置）。
 * 题目的候选知识点 = 标签库中该学科、该学段下的全部知识点。
 * 本文件前后端共用，不要引入服务端模块。
 */

import { inferSubjectFromName } from "@/lib/tags/knowledge-tags";

export const NOTEBOOK_STAGES = ["primary", "junior_high", "senior_high", "university"] as const;
export type NotebookStage = (typeof NOTEBOOK_STAGES)[number];
export const DEFAULT_NOTEBOOK_STAGE: NotebookStage = "primary";

export const NOTEBOOK_SUBJECTS = ["math", "english", "chinese", "science", "physics", "chemistry", "biology", "history", "geography", "politics"] as const;
export type NotebookSubject = (typeof NOTEBOOK_SUBJECTS)[number];

/**
 * 各学段可选的学科。科学的小学知识点由人教版课标体系提供（导入后可选），
 * 内置体系暂无科学课程，该错题本的知识点由 AI 生成后逐步收敛；其余学科沿用内置课程知识点。
 */
export const STAGE_SUBJECTS: Record<NotebookStage, readonly NotebookSubject[]> = {
    primary: ["math", "english", "chinese", "science"],
    junior_high: NOTEBOOK_SUBJECTS,
    senior_high: NOTEBOOK_SUBJECTS,
    // 大学没有内置课程知识点，知识点由 AI 在错题本内自由生成后逐步收敛
    university: NOTEBOOK_SUBJECTS,
};

/** 学科的中文名（提示词中使用） */
export const SUBJECT_DISPLAY_NAMES: Record<NotebookSubject, string> = {
    math: "数学", english: "英语", chinese: "语文", science: "科学", physics: "物理",
    chemistry: "化学", biology: "生物", history: "历史", geography: "地理", politics: "政治",
};

// 标签库顶层节点是年级（如「三年级」「七年级上」「高一下」，课标体系高中按册名为「高中 选必一」），按名称归入学段
const STAGE_GRADE_PATTERNS: Record<NotebookStage, RegExp> = {
    primary: /^[一二三四五六]年级/,
    junior_high: /^[七八九]年级/,
    senior_high: /^高[一二三中]/,
    university: /^大[一二三四]/,
};

export function isNotebookStage(value: unknown): value is NotebookStage {
    return typeof value === "string" && (NOTEBOOK_STAGES as readonly string[]).includes(value);
}

export function isNotebookSubject(value: unknown): value is NotebookSubject {
    return typeof value === "string" && (NOTEBOOK_SUBJECTS as readonly string[]).includes(value);
}

/** 学段与学科组合是否可选 */
export function isValidNotebookScope(stage: unknown, subject: unknown): boolean {
    return isNotebookStage(stage) && isNotebookSubject(subject) && STAGE_SUBJECTS[stage].includes(subject);
}

/** 年级节点名称是否属于该学段 */
export function isGradeInStage(gradeName: string, stage: NotebookStage): boolean {
    return STAGE_GRADE_PATTERNS[stage].test(gradeName);
}

/** 由用户的教育阶段得到错题本学段，未设置时按小学处理 */
export function stageFromEducationStage(educationStage: string | null | undefined): NotebookStage {
    return isNotebookStage(educationStage) ? educationStage : DEFAULT_NOTEBOOK_STAGE;
}

export interface NotebookScope {
    stage: NotebookStage;
    subject: NotebookSubject | null;
}

/** 读取错题本的学段和学科；旧错题本未记录学科时按名称推断 */
export function resolveNotebookScope(notebook: { stage?: string | null; subjectKey?: string | null; name: string }): NotebookScope {
    const subject = isNotebookSubject(notebook.subjectKey) ? notebook.subjectKey : inferSubjectFromName(notebook.name);
    return {
        stage: isNotebookStage(notebook.stage) ? notebook.stage : DEFAULT_NOTEBOOK_STAGE,
        subject: subject && isNotebookSubject(subject) ? subject : null,
    };
}

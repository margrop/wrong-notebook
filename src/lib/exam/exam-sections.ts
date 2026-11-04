/**
 * 试卷按题型分大题的纯函数：分组、大题标题、题号连续编号与分值小计。
 * 大题顺序固定为 QUESTION_TYPES 的定义顺序；未知题型归入「其他」。
 */

import { QUESTION_TYPES, QUESTION_TYPE_NAMES_EN, QUESTION_TYPE_NAMES_ZH } from "@/lib/question/question-type";
import type { QuestionType } from "@/lib/question/question-type";
import { summarizeExamScores } from "@/lib/exam/exam-score";
import type { ExamScoreSummary } from "@/lib/exam/exam-score";

export type ExamSectionLanguage = "zh" | "en";

/** 参与分组的试卷题目：questionType 为创建时的来源快照，可为空 */
export interface ExamSectionQuestion {
    id: string;
    order: number;
    /** 快照题型；空值时回退读取关联错题当前题型 */
    questionType?: string | null;
    /** 关联错题当前题型（errorItem 可能已删除，为 null） */
    errorItemQuestionType?: string | null;
    score?: number | null;
}

export interface ExamSectionItem<T extends ExamSectionQuestion> {
    question: T;
    /** 全卷连续题号（跨大题递增，从 1 开始） */
    displayNumber: number;
}

export interface ExamSection<T extends ExamSectionQuestion> {
    /** 标准题型 key；null 表示来源题型无法识别（归入「其他」） */
    type: QuestionType | null;
    /** 大题标题，如「一、选择题」或 "Part I. Single Choice" */
    title: string;
    /** 组内题目，保持卷内原 order */
    items: ExamSectionItem<T>[];
    /** 大题题数 */
    count: number;
    /** 分值小计（仅已设分值之和），无已设分值时为 null */
    scoreTotal: number | null;
    /** 未设分值的题目数 */
    unscored: number;
}

/** 中文数字序号（支持到二十，足以覆盖题型数量） */
const ZH_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十"];

const EN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];

/** 回退题型：快照为空时取关联错题当前题型；无法识别时归入 other */
function resolveSectionType(question: ExamSectionQuestion): QuestionType {
    const raw = question.questionType ?? question.errorItemQuestionType ?? null;
    return (QUESTION_TYPES as readonly string[]).includes(raw ?? "") ? raw as QuestionType : "other";
}
/** 生成大题标题：中文「一、选择题」，英文 "Part I. Single Choice" */
function sectionTitle(type: QuestionType, index: number, language: ExamSectionLanguage): string {
    const name = language === "zh" ? QUESTION_TYPE_NAMES_ZH[type] : QUESTION_TYPE_NAMES_EN[type];
    if (language === "zh") {
        return `${ZH_NUMERALS[index]}、${name}`;
    }
    return `Part ${EN_NUMERALS[index]}. ${name}`;
}

/**
 * 按题型把试卷题目分大题。
 * - 分组顺序固定为 QUESTION_TYPES 的定义顺序，空组不返回
 * - 组内保持卷内原 order 顺序
 * - displayNumber 为全卷连续题号（跨大题递增，从 1 开始）
 * - scoreTotal 只累加已设分值的题目；unscored 为未设分值题数
 */
export function groupExamQuestions<T extends ExamSectionQuestion>(
    questions: T[],
    language: ExamSectionLanguage,
): ExamSection<T>[] {
    const groups = new Map<QuestionType, T[]>();
    for (const type of QUESTION_TYPES) groups.set(type, []);
    // 按 order 稳定遍历，保证组内与组间顺序确定
    const ordered = [...questions].sort((a, b) => a.order - b.order);
    for (const question of ordered) {
        groups.get(resolveSectionType(question))!.push(question);
    }

    const sections: ExamSection<T>[] = [];
    let displayNumber = 1;
    let index = 0;
    for (const type of QUESTION_TYPES) {
        const group = groups.get(type)!;
        if (group.length === 0) continue;
        const summary: ExamScoreSummary = summarizeExamScores(group.map((question) => question.score ?? null));
        sections.push({
            type: type === "other" ? null : type,
            title: sectionTitle(type, index, language),
            items: group.map((question) => ({ question, displayNumber: displayNumber++ })),
            count: group.length,
            scoreTotal: summary.total,
            unscored: summary.unscored,
        });
        index += 1;
    }
    return sections;
}

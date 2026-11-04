/**
 * 「按原样入库」：把分题草稿中的一道题直接转为识别结果（ParsedQuestion），不调用 AI。
 * 供多题批次 startImportBatch 的 analysis: 'none' 路径使用，与 AI 识别结果一样
 * 通过 ParsedQuestionSchema（parseResult）校验后写入任务 result。
 */
import { ParsedQuestionSchema } from "@/lib/ai/schema";
import type { ParsedQuestion } from "@/lib/ai";
import type { DraftItem } from "@/lib/question-split/draft";
import { normalizeQuestionType } from "@/lib/question/question-type";

/** ParsedQuestionSchema 中 subject 枚举的中文名 */
const SUBJECT_NAMES = ["数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"] as const;

/** 题目原文：公共材料拼在题干前（与 composeQuestionInput 一致，但不附加参考答案等小节） */
function composeQuestionText(item: Pick<DraftItem, "text" | "material">): string {
    const text = item.text.trim();
    const material = item.material?.trim();
    return material ? `${material}\n\n${text}` : text;
}

/** 从错题本名称推断 ParsedQuestionSchema 可接受的学科名；不在清单内时为「其他」 */
function normalizeSubjectName(notebookName: string | null | undefined): ParsedQuestion["subject"] {
    const trimmed = notebookName?.trim() ?? "";
    return (SUBJECT_NAMES as readonly string[]).includes(trimmed) ? (trimmed as ParsedQuestion["subject"]) : "其他";
}

export interface DraftToParsedOptions {
    /** 目标错题本的名称；为空时学科记为「其他」 */
    notebookName?: string | null;
}

/**
 * ParsedQuestionSchema 中 answerText / analysis 要求 min(1)，空字符串无法通过校验；
 * 无答案/解析时用单个空格占位（保存到错题后语义上等同为空）。
 */
function nonEmpty(value: string | null | undefined): string {
    return value?.trim() ? value.trim() : " ";
}

/**
 * 草稿条目转为 ParsedQuestion；返回 null 表示必填字段缺失（题干为空）。
 * 字段映射：questionText = 公共材料 + 题干；answerText = answer（空时为占位空格）；
 * analysis = analysis（空时为占位空格）；知识点去重后按 ParsedQuestionSchema 上限只保留前 5 个；
 * 有错答时 mistakeStatus 为 wrong_attempt，否则 unknown。
 */
export function draftItemToParsed(item: DraftItem, options: DraftToParsedOptions = {}): ParsedQuestion | null {
    const questionText = composeQuestionText(item);
    if (!questionText) return null;
    const wrongAnswerText = item.wrongAnswer?.trim() ?? "";
    const knowledgePoints = Array.from(new Set((item.knowledgePoints ?? []).map((point) => point.trim()).filter(Boolean))).slice(0, 5);
    const result = {
        questionText,
        answerText: nonEmpty(item.answer),
        analysis: nonEmpty(item.analysis),
        wrongAnswerText,
        mistakeAnalysis: "",
        mistakeStatus: wrongAnswerText ? "wrong_attempt" as const : "unknown" as const,
        subject: normalizeSubjectName(options.notebookName),
        knowledgePoints,
        requiresImage: false,
        difficultyStars: item.difficultyStars ?? null,
        questionType: normalizeQuestionType(item.questionType),
        gradeSemester: null,
        hasFigure: item.hasFigure ?? false,
    };
    const parsed = ParsedQuestionSchema.safeParse(result);
    return parsed.success ? parsed.data : null;
}

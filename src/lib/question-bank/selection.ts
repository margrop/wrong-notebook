/**
 * 从真题库按知识点选题（服务端）：
 * 优先匹配错题的知识点标签，其次按同错题本、同学段、同学科与难度筛选；
 * 排除该错题最近已练习过的题目文本，避免连续重复。
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { SUBJECT_DISPLAY_NAMES, isNotebookSubject, resolveNotebookScope } from "@/lib/notebook-scope";
import type { NotebookStage, NotebookSubject } from "@/lib/notebook-scope";
import type { ParsedQuestion } from "@/lib/ai";
import type { DifficultyLevel } from "@/lib/ai/types";
import { bankQuestionGradeSemester, composeBankQuestionText } from "@/lib/question-bank/import";

/** 错题最近练习过的题目数上限：选题时排除这些题干 */
const EXCLUDE_RECENT_PRACTICES = 20;
/** 候选题目上限；题库单包最多 5000 题 */
const MAX_CANDIDATES = 5000;

const DIFFICULTY_STARS: Record<DifficultyLevel, number[]> = {
    easy: [1, 2],
    medium: [3],
    hard: [4],
    harder: [5],
};

const SUBJECT_NAMES = ["数学", "科学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"] as const;

export interface BankSelectionInput {
    userId: string;
    errorItem: {
        id: string;
        questionText: string | null;
        subject: { name: string; stage: string | null; subjectKey: string | null } | null;
    };
    tagNames: string[];
    difficulty: DifficultyLevel;
    bankId?: string | null;
}

export interface BankSelectionResult {
    question: ParsedQuestion;
    bankId: string;
    bankName: string;
    bankQuestionId: string;
}

/** 知识点名称归一化：去空格与常见分隔符，便于题库标签与错题标签比对 */
function normalizeTag(name: string): string {
    return name.trim().toLowerCase().replace(/[\s·・、,，;；:：()（）\-_/]+/g, "");
}

/** 计算题库题目的知识点匹配分：同名 10 分，包含关系 5 分 */
function knowledgeScore(questionPoints: string[], errorTags: string[]): number {
    if (!errorTags.length || !questionPoints.length) return 0;
    const normalizedError = errorTags.map(normalizeTag).filter(Boolean);
    const normalizedQuestion = questionPoints.map(normalizeTag).filter(Boolean);
    let score = 0;
    for (const questionPoint of normalizedQuestion) {
        for (const errorTag of normalizedError) {
            if (questionPoint === errorTag) score += 10;
            else if (questionPoint.length >= 2 && errorTag.length >= 2 && (questionPoint.includes(errorTag) || errorTag.includes(questionPoint))) score += 5;
        }
    }
    return score;
}

function parsePoints(raw: string | null): string[] {
    try {
        const parsed: unknown = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.filter((point): point is string => typeof point === 'string') : [];
    } catch {
        return [];
    }
}

function toSubjectName(subjectKey: string | null): ParsedQuestion["subject"] {
    if (!subjectKey || !isNotebookSubject(subjectKey)) return "其他";
    const name = SUBJECT_DISPLAY_NAMES[subjectKey];
    return (SUBJECT_NAMES as readonly string[]).includes(name) ? name as ParsedQuestion["subject"] : "其他";
}

/**
 * 选题结果；没有可用题目时返回 null。
 * 按难度先筛，若无候选则放宽难度；知识点优先，若无匹配则按同学科同学段兜底。
 */
export async function selectBankQuestion(input: BankSelectionInput): Promise<BankSelectionResult | null> {
    const scope = input.errorItem.subject
        ? resolveNotebookScope(input.errorItem.subject)
        : { stage: "primary" as NotebookStage, subject: null as NotebookSubject | null };

    const banks = await prisma.questionBank.findMany({
        where: {
            userId: input.userId,
            ...(input.bankId ? { id: input.bankId } : {}),
        },
        select: { id: true, name: true },
    });
    if (banks.length === 0) return null;
    const bankNames = new Map(banks.map((bank) => [bank.id, bank.name]));

    const baseWhere = {
        bankId: { in: banks.map((bank) => bank.id) },
        ...(scope.subject ? { subjectKey: scope.subject } : {}),
        stage: scope.stage,
    };

    const recent = input.errorItem.id
        ? await prisma.practiceRecord.findMany({
            where: { errorItemId: input.errorItem.id, questionText: { not: null } },
            orderBy: { createdAt: 'desc' },
            take: EXCLUDE_RECENT_PRACTICES,
            select: { questionText: true },
        })
        : [];
    const excluded = new Set(recent.map((record) => record.questionText?.trim()).filter(Boolean) as string[]);

    const fetchCandidates = async (stars?: number[]) => prisma.bankQuestion.findMany({
        where: {
            ...baseWhere,
            ...(stars ? { difficultyStars: { in: stars } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_CANDIDATES,
        select: {
            id: true, bankId: true, text: true, material: true, optionsJson: true, answer: true,
            analysis: true, knowledgePoints: true, difficultyStars: true, questionType: true,
            grade: true, semester: true, figureSvg: true, subjectKey: true, source: true,
        },
    });

    const preferredStars = DIFFICULTY_STARS[input.difficulty] ?? DIFFICULTY_STARS.medium;
    const candidates = await fetchCandidates();

    const usable = candidates.filter((question) => !excluded.has(question.text.trim()));
    if (usable.length === 0) return null;

    const scored = usable.map((question) => ({
        question,
        score: knowledgeScore(parsePoints(question.knowledgePoints), input.tagNames),
    }));
    const maxScore = Math.max(...scored.map((entry) => entry.score));
    let pool = scored.filter((entry) => entry.score === maxScore);
    // 知识点匹配优先；同分时优先所选难度，若该难度没有候选则放宽
    const preferred = pool.filter((entry) => entry.question.difficultyStars !== null
        && preferredStars.includes(entry.question.difficultyStars));
    if (preferred.length > 0) pool = preferred;
    const chosen = pool[Math.floor(Math.random() * pool.length)].question;

    const answerText = chosen.answer?.trim() || " ";
    const analysis = chosen.analysis?.trim() || " ";
    const subject = toSubjectName(chosen.subjectKey);
    const knowledgePoints = parsePoints(chosen.knowledgePoints).slice(0, 5);
    const question: ParsedQuestion = {
        questionText: composeBankQuestionText(chosen),
        answerText,
        analysis,
        wrongAnswerText: "",
        mistakeAnalysis: "",
        mistakeStatus: "unknown",
        subject,
        knowledgePoints,
        requiresImage: false,
        difficultyStars: chosen.difficultyStars ?? null,
        questionType: chosen.questionType ?? null,
        gradeSemester: bankQuestionGradeSemester(chosen),
        hasFigure: !!chosen.figureSvg,
        figureSvg: chosen.figureSvg ?? null,
        source: `真题库 · ${bankNames.get(chosen.bankId) ?? ""}`.slice(0, 200),
    };
    return {
        question,
        bankId: chosen.bankId,
        bankName: bankNames.get(chosen.bankId) ?? "",
        bankQuestionId: chosen.id,
    };
}

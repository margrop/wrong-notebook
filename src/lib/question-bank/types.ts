/**
 * 真题库前后端共用类型（不依赖 Prisma，可在浏览器中引用）。
 */
import type { NotebookStage, NotebookSubject } from "@/lib/notebook-scope";

/** 题库包顶层格式 */
export const BANK_FORMAT = "wrong-notebook-question-bank";
export const BANK_VERSION = 1;
/** 共享题库索引格式 */
export const BANK_INDEX_FORMAT = "wrong-notebook-question-bank-index";
export const BANK_INDEX_VERSION = 1;
/** 单包题目上限 */
export const MAX_BANK_QUESTIONS = 5000;

/** 默认共享题库索引地址；应用内「从共享题库下载」读取此地址 */
export const DEFAULT_BANK_INDEX_URL =
    "https://cdn.jsdelivr.net/gh/margrop/wrong-notebook-question-bank@main/index.json";

/** 题库包元信息 */
export interface BankMeta {
    id: string;
    title: string;
    description?: string;
    stage: NotebookStage;
    subject: NotebookSubject;
    grades: number[];
    count: number;
    tagged: boolean;
    source: string;
    sourceUrl?: string;
    license: string;
    updatedAt?: string;
}

/** 题库包内的单题（已规范化） */
export interface NormalizedBankQuestion {
    externalId: string | null;
    stage: NotebookStage;
    subjectKey: NotebookSubject;
    grade: number | null;
    semester: string | null;
    questionType: string | null;
    difficultyStars: number | null;
    text: string;
    material: string | null;
    optionsJson: string | null;
    answer: string | null;
    analysis: string | null;
    knowledgePoints: string[];
    source: string | null;
    figureSvg: string | null;
}

/** 解析后的题库包 */
export interface ParsedBankFile {
    meta: BankMeta;
    questions: NormalizedBankQuestion[];
}

/** 索引中的题库包条目 */
export interface BankIndexPackage {
    id: string;
    title: string;
    stage: NotebookStage;
    subject: NotebookSubject;
    grades: number[];
    count: number;
    tagged: boolean;
    source: string;
    license: string;
    file: string;
    sizeBytes: number;
    sha256: string;
}

export interface BankIndex {
    format: typeof BANK_INDEX_FORMAT;
    version: typeof BANK_INDEX_VERSION;
    updatedAt: string;
    packages: BankIndexPackage[];
}

/** 管理接口返回的题库摘要 */
export interface QuestionBankSummary {
    id: string;
    name: string;
    description: string | null;
    stage: string;
    subjectKey: string | null;
    gradeRange: string | null;
    source: string | null;
    sourceUrl: string | null;
    license: string | null;
    questionCount: number;
    createdAt: string;
    updatedAt: string;
}

/** 题库详情中的题目行 */
export interface BankQuestionRow {
    id: string;
    externalId: string | null;
    stage: string;
    subjectKey: string | null;
    grade: number | null;
    semester: string | null;
    questionType: string | null;
    difficultyStars: number | null;
    text: string;
    optionsJson: string | null;
    answer: string | null;
    analysis: string | null;
    knowledgePoints: string[];
    source: string | null;
    figureSvg: string | null;
}

/** 题库详情（分页题目） */
export interface QuestionBankDetail extends QuestionBankSummary {
    questions: BankQuestionRow[];
    total: number;
    page: number;
    pageSize: number;
}

/** 导入结果 */
export interface BankImportResult {
    bank: QuestionBankSummary;
    errorItemsCreated: number;
    duplicates: number;
}

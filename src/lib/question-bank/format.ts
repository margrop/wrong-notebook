/**
 * 真题库包与索引的解析、校验（纯函数，前后端共用）。
 * 包格式见共享仓库 margrop/wrong-notebook-question-bank 的 schema/question-bank.schema.json。
 */
import { z } from "zod";
import { isNotebookStage, isNotebookSubject } from "@/lib/notebook-scope";
import type { NotebookStage, NotebookSubject } from "@/lib/notebook-scope";
import { normalizeQuestionType } from "@/lib/question/question-type";
import {
    BANK_FORMAT,
    BANK_INDEX_FORMAT,
    BANK_INDEX_VERSION,
    BANK_VERSION,
    MAX_BANK_QUESTIONS,
} from "@/lib/question-bank/types";
import type {
    BankIndex,
    BankMeta,
    NormalizedBankQuestion,
    ParsedBankFile,
} from "@/lib/question-bank/types";

const QUESTION_MAX_TEXT = 20_000;
const QUESTION_MAX_ANSWER = 20_000;
const QUESTION_MAX_ANALYSIS = 50_000;
const QUESTION_MAX_KNOWLEDGE_POINT = 200;
const MAX_KNOWLEDGE_POINTS = 100;

const bankQuestionSchema = z.object({
    id: z.string().trim().max(200).optional().nullable(),
    stage: z.string().trim().max(30).optional().nullable(),
    subjectKey: z.string().trim().max(30).optional().nullable(),
    grade: z.number().int().min(1).max(12).optional().nullable(),
    semester: z.string().trim().max(10).optional().nullable(),
    questionType: z.string().trim().max(200).optional().nullable(),
    difficultyStars: z.number().int().min(1).max(5).optional().nullable(),
    text: z.string().trim().min(1).max(QUESTION_MAX_TEXT),
    material: z.string().trim().max(QUESTION_MAX_TEXT).optional().nullable(),
    options: z.record(z.string().max(10), z.string().max(5_000)).optional().nullable(),
    answer: z.string().max(QUESTION_MAX_ANSWER).optional().nullable(),
    analysis: z.string().max(QUESTION_MAX_ANALYSIS).optional().nullable(),
    knowledgePoints: z.array(z.string().trim().min(1).max(QUESTION_MAX_KNOWLEDGE_POINT)).max(MAX_KNOWLEDGE_POINTS).optional(),
    source: z.string().trim().max(200).optional().nullable(),
    figureSvg: z.string().max(1_500_000).optional().nullable(),
}).strip();

const bankMetaSchema = z.object({
    id: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1_000).optional(),
    stage: z.string().trim(),
    subject: z.string().trim(),
    grades: z.array(z.number().int().min(1).max(12)).max(12).optional(),
    count: z.number().int().nonnegative().optional(),
    tagged: z.boolean().optional(),
    source: z.string().trim().min(1).max(200),
    sourceUrl: z.string().trim().max(500).optional(),
    license: z.string().trim().min(1).max(200),
    updatedAt: z.string().trim().max(50).optional(),
}).strip();

const bankFileSchema = z.object({
    format: z.literal(BANK_FORMAT),
    version: z.literal(BANK_VERSION),
    meta: bankMetaSchema,
    questions: z.array(bankQuestionSchema).min(1).max(MAX_BANK_QUESTIONS),
}).strip();

const indexPackageSchema = z.object({
    id: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    stage: z.string().trim(),
    subject: z.string().trim(),
    grades: z.array(z.number().int().min(1).max(12)).max(12).optional(),
    count: z.number().int().nonnegative(),
    tagged: z.boolean().optional(),
    source: z.string().trim().min(1).max(200),
    license: z.string().trim().min(1).max(200),
    file: z.string().trim().min(1).max(300),
    sizeBytes: z.number().int().nonnegative().optional(),
    sha256: z.string().trim().max(64).optional(),
}).strip();

const bankIndexSchema = z.object({
    format: z.literal(BANK_INDEX_FORMAT),
    version: z.literal(BANK_INDEX_VERSION),
    updatedAt: z.string().trim().max(50).optional(),
    packages: z.array(indexPackageSchema).max(500),
}).strip();

function nullableText(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

/** 把单题规范化为可写库结构；stage/subject 缺省沿用包元信息 */
function normalizeQuestion(
    question: z.infer<typeof bankQuestionSchema>,
    meta: BankMeta,
): NormalizedBankQuestion {
    const stage = isNotebookStage(question.stage) ? question.stage : meta.stage;
    const subjectKey = isNotebookSubject(question.subjectKey) ? question.subjectKey : meta.subject;
    const knowledgePoints = Array.from(new Set((question.knowledgePoints ?? []).map((point) => point.trim()).filter(Boolean)));
    return {
        externalId: nullableText(question.id),
        stage,
        subjectKey,
        grade: question.grade ?? null,
        semester: nullableText(question.semester),
        questionType: normalizeQuestionType(question.questionType),
        difficultyStars: question.difficultyStars ?? null,
        text: question.text,
        material: nullableText(question.material),
        optionsJson: question.options && Object.keys(question.options).length > 0
            ? JSON.stringify(question.options)
            : null,
        answer: nullableText(question.answer),
        analysis: nullableText(question.analysis),
        knowledgePoints,
        source: nullableText(question.source),
        figureSvg: nullableText(question.figureSvg),
    };
}

/** 解析题库包；meta.count 与实际题数不一致时以实际题数为准 */
export function parseBankFile(input: unknown): { success: true; data: ParsedBankFile } | { success: false; error: string } {
    const result = bankFileSchema.safeParse(input);
    if (!result.success) {
        const issue = result.error.issues[0];
        return { success: false, error: `${issue.path.join(".") || "root"}: ${issue.message}` };
    }
    const { meta, questions } = result.data;
    if (!isNotebookStage(meta.stage)) {
        return { success: false, error: `meta.stage: ${meta.stage}` };
    }
    if (!isNotebookSubject(meta.subject)) {
        return { success: false, error: `meta.subject: ${meta.subject}` };
    }
    const parsedMeta: BankMeta = {
        id: meta.id,
        title: meta.title,
        description: meta.description,
        stage: meta.stage as NotebookStage,
        subject: meta.subject as NotebookSubject,
        grades: meta.grades ?? [],
        count: questions.length,
        tagged: meta.tagged ?? questions.some((question) => (question.knowledgePoints ?? []).length > 0),
        source: meta.source,
        sourceUrl: meta.sourceUrl,
        license: meta.license,
        updatedAt: meta.updatedAt,
    };
    return {
        success: true,
        data: { meta: parsedMeta, questions: questions.map((question) => normalizeQuestion(question, parsedMeta)) },
    };
}

/** 解析共享题库索引 */
export function parseBankIndex(input: unknown): { success: true; data: BankIndex } | { success: false; error: string } {
    const result = bankIndexSchema.safeParse(input);
    if (!result.success) {
        const issue = result.error.issues[0];
        return { success: false, error: `${issue.path.join(".") || "root"}: ${issue.message}` };
    }
    const packages = result.data.packages.flatMap((item) => {
        if (!isNotebookStage(item.stage) || !isNotebookSubject(item.subject)) return [];
        return [{
            id: item.id,
            title: item.title,
            stage: item.stage,
            subject: item.subject,
            grades: item.grades ?? [],
            count: item.count,
            tagged: item.tagged ?? false,
            source: item.source,
            license: item.license,
            file: item.file,
            sizeBytes: item.sizeBytes ?? 0,
            sha256: item.sha256 ?? "",
        }];
    });
    return {
        success: true,
        data: {
            format: BANK_INDEX_FORMAT,
            version: BANK_INDEX_VERSION,
            updatedAt: result.data.updatedAt ?? "",
            packages,
        },
    };
}

/** 由索引地址得到题库包下载地址（同目录相对路径） */
export function bankPackageUrl(indexUrl: string, file: string): string {
    const base = indexUrl.slice(0, indexUrl.lastIndexOf("/") + 1);
    return `${base}${file}`;
}

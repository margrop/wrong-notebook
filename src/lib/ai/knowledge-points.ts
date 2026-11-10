import { MAX_KNOWLEDGE_TAGS } from './schema';
import type { PromptOptions } from './prompts';

const SUBJECT_TAG_FIELDS = {
    数学: 'prefetchedMathTags', 科学: 'prefetchedScienceTags', 物理: 'prefetchedPhysicsTags',
    化学: 'prefetchedChemistryTags', 生物: 'prefetchedBiologyTags', 英语: 'prefetchedEnglishTags',
    语文: 'prefetchedChineseTags', 历史: 'prefetchedHistoryTags', 地理: 'prefetchedGeographyTags',
    政治: 'prefetchedPoliticsTags',
} as const;

/**
 * 有候选集合时只采用集合内的标签；allowCustom 时（该学段没有内置课程知识点）保留 AI 自行命名的标签，
 * 候选集合里的已有标签由提示词要求优先复用；未提供集合时仍去重并限制数量。
 */
export function normalizeAiQuestionTags<T extends { knowledgePoints: string[]; subject?: string }>(question: T, options: PromptOptions): T {
    const allowCustom = options.candidateTags?.allowCustom === true;
    let allowedTags: string[] | undefined;
    if (!allowCustom) {
        allowedTags = options.candidateTags?.tags;
        if (!options.candidateTags) {
            const field = SUBJECT_TAG_FIELDS[question.subject as keyof typeof SUBJECT_TAG_FIELDS];
            if (field) {
                // 该学科暂无内置知识点（如历史、地理、政治）时允许 AI 自行命名
                const subjectTags = options[field];
                allowedTags = subjectTags?.length ? subjectTags : undefined;
            } else {
                const available = Object.values(SUBJECT_TAG_FIELDS)
                    .flatMap(key => options[key] ?? []);
                allowedTags = available.length ? available : undefined;
            }
        }
    }
    const allowed = allowedTags ? new Set(allowedTags) : null;
    const knowledgePoints = [...new Set(question.knowledgePoints.map(tag => tag.trim()).filter(tag => tag && (!allowed || allowed.has(tag))))].slice(0, MAX_KNOWLEDGE_TAGS);
    return { ...question, knowledgePoints };
}
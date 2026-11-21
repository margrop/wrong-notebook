import type { QuestionType } from '@/lib/question/question-type';

export interface TeachingRuleContext {
    subject?: string | null;
    questionType?: string | null;
    knowledgePoints?: readonly string[];
    gradeSemester?: string | null;
}

export interface TeachingRuleDefinition {
    id: string;
    subject: string;
    questionType: QuestionType;
    instructions: {
        zh: string;
        en: string;
    };
}

export interface TeachingRuleResolution {
    ruleId: string;
    matched: boolean;
    confidence: 'high' | 'fallback';
    subject: string | null;
    questionType: QuestionType | null;
    instructions: string;
}

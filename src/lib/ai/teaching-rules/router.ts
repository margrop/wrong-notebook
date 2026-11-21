import { normalizeQuestionType } from '@/lib/question/question-type';
import { normalizeSubject } from '../schema';
import { GENERIC_TEACHING_RULE_ID, TEACHING_RULES } from './manifest';
import type { TeachingRuleContext, TeachingRuleResolution } from './types';

/**
 * 按受控的科目和题型选择讲解规则。无法精确匹配时返回通用兜底，保证旧题和新题都能继续解答。
 */
export function resolveTeachingRule(
    context: TeachingRuleContext,
    language: 'zh' | 'en' = 'zh',
): TeachingRuleResolution {
    const subject = normalizeSubject(context.subject) ?? null;
    const questionType = normalizeQuestionType(context.questionType);
    const matched = TEACHING_RULES.find((rule) => rule.subject === subject && rule.questionType === questionType);

    if (!matched) {
        return {
            ruleId: GENERIC_TEACHING_RULE_ID,
            matched: false,
            confidence: 'fallback',
            subject,
            questionType,
            instructions: '',
        };
    }

    return {
        ruleId: matched.id,
        matched: true,
        confidence: 'high',
        subject,
        questionType,
        instructions: matched.instructions[language],
    };
}

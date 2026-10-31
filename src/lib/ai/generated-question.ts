import type { ParsedQuestion } from './types';

/** 只清理生成题目的排版标记，原题识别保持原文。 */
export function normalizeGeneratedQuestion(question: ParsedQuestion): ParsedQuestion {
    const questionText = question.questionText
        .replace(/[（(【\[]\s*(?:(?:本题|共|满分)\s*)?\d+(?:\.\d+)?\s*(?:分|points?|marks?|pts?\.?)\s*[）)】\]]/giu, '')
        .replace(/^\s*(?:#{1,6}\s*)?(?:第\s*\d+\s*题\s*[:：.、]?|(?:Question|Problem)\s*\d+\s*[:：.、]?|\d+\s*(?:[、．]|\.(?!\d)))\s*/iu, '')
        .trim();

    // 不能靠删除选项把选择题变成填空题；不合规输出交给现有的生成失败/重试流程处理。
    const hasOptionLine = /^\s*(?:[-*]\s*)?(?:[A-DＡ-Ｄ][.．、:：)）]|[（(][A-DＡ-Ｄ][）)])\s*\S/imu.test(questionText);
    const inlineOptions = questionText.match(/(?:^|\s)(?:[A-DＡ-Ｄ][.．、:：)）]|[（(][A-DＡ-Ｄ][）)])/giu) || [];

    // 圈码检测：区分"候选选项"和"条件编号"
    // 多个信号综合判断，避免单一信号失效导致误判
    const hasChoiceLeadIn = /(?:下列|以下|选择|答案|哪项|哪一|正确的是|正确的是)/u.test(questionText);
    const circledItems = questionText.match(/[①②③④⑤⑥⑦⑧⑨⑩][^①②③④⑤⑥⑦⑧⑨⑩]*/gu) || [];

    const isChoiceWithCircled = (() => {
        if (circledItems.length < 2) return false;
        // 有引导词时：≥2 个圈码即可判为选项（引导词是强信号）
        if (hasChoiceLeadIn) return true;
        // 无引导词时：要求 ≥4 个圈码（对应 ABCD 四项），避免把条件编号误判为选项
        if (circledItems.length >= 4) return true;
        return false;
    })();

    if (!questionText || hasOptionLine || inlineOptions.length >= 2 || isChoiceWithCircled) {
        throw new Error('AI_RESPONSE_ERROR: 生成题目必须为不含选项的填空题或解答题');
    }

    return { ...question, questionText };
}

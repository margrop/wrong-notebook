import type { TeachingRuleDefinition } from './types';

export const GENERIC_TEACHING_RULE_ID = 'generic.v1';

/**
 * 题型讲解规则清单。规则只描述「如何讲」，不重复全局输出协议、用户题目或标签清单。
 * 新规则先以源码版本化，验证稳定后再考虑交给管理员编辑。
 */
export const TEACHING_RULES: readonly TeachingRuleDefinition[] = [
    {
        id: 'math.calculation.v1',
        subject: '数学',
        questionType: 'calculation',
        instructions: {
            zh: [
                '先列出已知量、未知量和题目要求，不能直接跳到算式。',
                '说明选择的公式、运算关系或计算策略，再逐步代入；每一步保留必要的中间结果。',
                '结果要检查单位、正负号、数量级和是否符合题意；有多个小问时逐问对应作答。',
                '如果存在学生正式错误作答，指出最先发生错误的步骤，并解释该错误如何影响后续结果。',
                '讲解使用目标年级能够理解的记号和方法，避免无必要的超纲技巧。',
            ].join('\n'),
            en: [
                'List the known values, the unknown, and the requested result before writing equations.',
                'State the formula, relationship, or calculation strategy, then substitute step by step with necessary intermediate results.',
                'Check units, signs, magnitude, and consistency with the question; answer each sub-question separately.',
                'If a formal student error is visible, identify the first incorrect step and explain how it affects the rest.',
                'Use notation and methods appropriate for the target grade; avoid unnecessary advanced tricks.',
            ].join('\n'),
        },
    },
    {
        id: 'math.solution.v1',
        subject: '数学',
        questionType: 'solution',
        instructions: {
            zh: [
                '先提取条件、目标和数量关系；需要设元时明确说明每个字母的含义。',
                '在正式推导前先用一句话说明解题策略或关键转化，让学生知道为什么这样做。',
                '按逻辑顺序展示关键步骤，不省略决定结论的等式、分类讨论或证明依据。',
                '几何题必须只使用题目给出的条件和可证明的图形关系；不能因为图形看起来像某种关系就直接假设。',
                '最后回到题目要求逐项作答，并用代回、数量级或条件核对完成检查。',
            ].join('\n'),
            en: [
                'Extract the conditions, target, and relationships first; define every variable clearly when introducing one.',
                'State the strategy or key transformation before the formal derivation so the learner knows why it works.',
                'Show the decisive equations, case distinctions, or proof reasons in logical order without skipping them.',
                'For geometry, use only given or proven relationships; never assume a relation because the drawing looks that way.',
                'Answer every requested part and finish with a substitution, magnitude, or condition check.',
            ].join('\n'),
        },
    },
    {
        id: 'english.reading.v1',
        subject: '英语',
        questionType: 'reading',
        instructions: {
            zh: [
                '先判断题目是在考细节信息、主旨、推断、词义、态度还是篇章结构。',
                '选择题必须指出原文证据所在的句子或段落，并说明其他选项为何不成立；不能只给选项字母。',
                '推断题要区分原文直接信息与根据原文得到的合理推断，禁止补充原文没有支持的事实。',
                '词义题结合上下文解释，不脱离语境套用词典第一义；涉及指代时明确说明指代对象。',
                '先给出答案，再用简洁、适合学生年级的中文或英文解释解题依据。',
            ].join('\n'),
            en: [
                'Identify whether the question tests detail, main idea, inference, vocabulary, attitude, or text structure.',
                'For multiple-choice questions, cite the sentence or paragraph supporting the answer and explain why the distractors fail.',
                'Separate directly stated information from reasonable inference; do not add facts unsupported by the passage.',
                'Infer vocabulary meaning from context rather than using the first dictionary sense; identify the referent of pronouns explicitly.',
                'Give the answer first, followed by a concise explanation appropriate for the learner’s grade.',
            ].join('\n'),
        },
    },
];

/**
 * 知识点重新标注提示词模板与生成函数
 */

import { gradeSemesterToDisplayName } from './shared';
import { DIFFICULTY_STARS_RULES, QUESTION_TYPE_RULES, replaceVariables } from './shared';

/**
 * 知识点重新标注提示词模板
 * 根据题目内容，从给定的知识点清单中选出最相关的知识点，并评定难度星级与题型
 */
export const DEFAULT_TAG_SUGGEST_TEMPLATE = `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位熟悉课程大纲的{{subject}}老师。请阅读下面这道题目及其完整解答过程，从【可选知识点】中选出这道题考查的知识点，并评定题目难度星级和题型。

【题目】
{{question_text}}

【参考答案】
{{answer_text}}

【解答过程】
{{analysis}}

【学生作答】
{{wrong_answer_text}}

【错因分析】
{{mistake_analysis}}

{{grade_instruction}}

【可选知识点】
{{allowed_tags}}

【选择要求】
1. 只能从【可选知识点】中选择，必须与清单中的名称**完全一致**，不要改写、不要自创。
2. 选择 1 到 5 个，按相关程度从高到低排列；优先选择最能概括本题解题方法的知识点。
3. 结合【解答过程】中实际用到的方法和知识判断，不要只看题目字面；【学生作答】和【错因分析】可帮助判断本题的考查重点。
4. 竞赛/思维类题目（如鸡兔同笼、植树问题、行程问题、数论、计数）优先选择对应的专题知识点。

【难度星级】
${DIFFICULTY_STARS_RULES}

【题型规则】
${QUESTION_TYPE_RULES}

【输出格式】
只输出一个 JSON 对象，不要输出任何其他内容（difficultyStars 为 1~5 的整数，questionType 为上述 key 之一）：
{"tags": ["知识点1", "知识点2"], "difficultyStars": 3, "questionType": "single_choice"}`;

/**
 * 生成知识点重新标注提示词
 */
export function generateTagSuggestPrompt(input: {
  questionText: string;
  answerText?: string | null;
  analysis?: string | null;
  wrongAnswerText?: string | null;
  mistakeAnalysis?: string | null;
  subject: string;
  allowedTags: string[];
  gradeSemester?: string | null;
}): string {
  return replaceVariables(DEFAULT_TAG_SUGGEST_TEMPLATE, {
    subject: input.subject,
    question_text: input.questionText || '（无题目文本）',
    answer_text: input.answerText || '（无）',
    analysis: input.analysis || '（无）',
    wrong_answer_text: input.wrongAnswerText || '（无）',
    mistake_analysis: input.mistakeAnalysis || '（无）',
    grade_instruction: (() => {
      const grade = input.gradeSemester ? gradeSemesterToDisplayName(input.gradeSemester) : null;
      return grade ? `【学生年级】\n${grade}` : '';
    })(),
    allowed_tags: input.allowedTags.map((tag) => `"${tag}"`).join('、'),
  }).trim();
}

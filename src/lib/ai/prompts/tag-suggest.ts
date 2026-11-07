/**
 * 知识点重新标注提示词模板与生成函数
 */

import { gradeSemesterToDisplayName } from './shared';
import { DIFFICULTY_STARS_RULES, QUESTION_TYPE_RULES, replaceVariables } from './shared';

/**
 * 知识点重新标注提示词模板
 * 根据题目内容，从给定的知识点清单中选出最相关的知识点，并评定难度星级与题型。
 * 该模板不对用户开放定制，{{knowledge_source}} 与 {{selection_rules}} 由生成函数按是否有课程库切换。
 */
export const DEFAULT_TAG_SUGGEST_TEMPLATE = `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位熟悉课程大纲的{{subject}}老师。请阅读下面这道题目及其完整解答过程，{{knowledge_source}}，并评定题目难度星级和题型。

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
{{selection_rules}}

【难度星级】
${DIFFICULTY_STARS_RULES}

【题型规则】
${QUESTION_TYPE_RULES}

【输出格式】
只输出一个 JSON 对象，不要输出任何其他内容（difficultyStars 为 1~5 的整数，questionType 为上述 key 之一）：
{"tags": ["知识点1", "知识点2"], "difficultyStars": 3, "questionType": "single_choice"}`;

/** 有课程知识点库：只能从清单中选择 */
const LIBRARY_SELECTION_RULES = `1. 只能从【可选知识点】中选择，必须与清单中的名称**完全一致**，不要改写、不要自创。
2. 选择 1 到 5 个，按相关程度从高到低排列；优先选择最能概括本题解题方法的知识点。
3. 结合【解答过程】中实际用到的方法和知识判断，不要只看题目字面；【学生作答】和【错因分析】可帮助判断本题的考查重点。
4. 竞赛/思维类题目（如鸡兔同笼、植树问题、行程问题、数论、计数）优先选择对应的专题知识点。`;

/** 该学段没有内置课程知识点（如大学）：优先复用已有标签，没有合适的再自行命名 */
const FREEFORM_SELECTION_RULES = `1. 本题所在学段没有固定课程知识点清单，【可选知识点】只列出了本错题本已有的知识点：与题意吻合的必须原样复用，不要换个说法重命名。
2. 没有吻合的再自行命名：使用教材或考纲中的标准术语（如「导数的定义」「特征值与特征向量」「边际效用」），不要用题号、分值、题目原文片段或「其他」这类无信息量的名称。
3. 选择 1 到 5 个，按相关程度从高到低排列；优先选择最能概括本题解题方法的知识点，逐级细化到二级主题即可，不要写成整段描述。
4. 结合【解答过程】中实际用到的方法和知识判断，不要只看题目字面；同一名称在同一错题本内必须保持一致。`;

/**
 * 生成知识点重新标注提示词
 * allowCustom 为 true 时（该学段没有内置课程知识点）允许 AI 自行命名
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
  allowCustom?: boolean;
}): string {
  const allowCustom = input.allowCustom === true;
  const allowedTags = input.allowedTags.map((tag) => `"${tag}"`).join('、');
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
    knowledge_source: allowCustom ? '选出现有知识点或自行命名本题考查的知识点' : '从【可选知识点】中选出这道题考查的知识点',
    allowed_tags: allowCustom
      ? (allowedTags || '（暂无，可自行命名）')
      : allowedTags,
    selection_rules: allowCustom ? FREEFORM_SELECTION_RULES : LIBRARY_SELECTION_RULES,
  }).trim();
}
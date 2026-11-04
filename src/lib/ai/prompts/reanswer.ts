/**
 * 重新解题提示词模板与生成函数
 */

import {
    generateFieldLanguageInstruction,
    generateGradeInstruction,
    generateGradeRecognitionInstruction,
    generateOutputContract,
    DRAFT_FILTER_RULES,
    DIFFICULTY_STARS_RULES,
    QUESTION_TYPE_RULES,
    LATEX_RULES,
    replaceVariables,
} from './shared';
import type { PromptOptions } from './shared';

/**
 * 重新解题提示词模板
 * 用于根据校正后的题目文本重新生成答案和解析
 */
export const DEFAULT_REANSWER_TEMPLATE = `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位经验丰富的专业教师。用户已经提供了一道**校正后的题目文本**，请你为这道题目提供正确的答案和详细的解析。

{{language_instruction}}

【题目内容 (QUESTION)】
{{question_text}}

【学科提示 (SUBJECT HINT)】
{{subject_hint}}

【核心输出要求 (OUTPUT REQUIREMENTS)】
你的响应输出**必须严格遵循以下自定义标签格式**。**严禁**使用 JSON 或 Markdown 代码块。

请严格按照以下结构输出内容（不要包含任何其他文字）：

<answer_text>
在此处填写正确答案。使用 Markdown 和 LaTeX 符号。
</answer_text>

<analysis>
在此处填写详细的步骤解析。
* 解析语言遵循字段语言规则。
* **直接使用标准的 LaTeX 符号**（如 $\\frac{1}{2}$），**不要**进行 JSON 转义。
* 解析要清晰、完整，适合学生理解。
</analysis>

<knowledge_points>
在此处填写知识点，使用逗号分隔，例如：知识点1, 知识点2, 知识点3
{{knowledge_points_rule}}
</knowledge_points>

<wrong_answer_text>
请只根据校正后的题目文本和当前图片中可见的学生作答痕迹重新判断学生错误解答。如果当前图片中可见正式错误答案或正式错误步骤，请按原样摘录；必须过滤掉空白处或题干旁的草稿、竖式演算、试算涂改、审题圈画和人的思考过程批注。如果只有草稿/思考痕迹或看不到学生作答痕迹，请留空，不要猜测。
</wrong_answer_text>

<mistake_status>
重新判断并填写以下值之一：wrong_attempt（当前题目文本或当前图片中明确有正式错误答案或正式错误步骤；仅有草稿或思考批注不算作答）、not_attempted（当前图片明确显示未作答、空白，或仅有草稿/思考痕迹）、unknown（看不到学生作答痕迹或无法判断）。不要猜测。
</mistake_status>

<mistake_analysis>
请基于校正后的题目和当前图片中可见的学生作答痕迹重新判断错因。如果有可见的正式错误解答，请分析错误可能发生在哪一步、为什么错、导致了什么后果；必须忽略零散草稿和人的思考过程，如果看不到学生作答痕迹或无法判断，请留空，不要猜测。
</mistake_analysis>

<subject>
判断题目所属学科，只能填写以下之一：数学、物理、化学、生物、英语、语文、历史、地理、政治、其他
</subject>

<difficulty_stars>
只填写 1 到 5 之间的一个整数，表示题目难度星级。
${DIFFICULTY_STARS_RULES}
</difficulty_stars>

<question_type>
${QUESTION_TYPE_RULES}
</question_type>

【!!! 关键格式与内容约束 (CRITICAL RULES) !!!】
1. **格式严格**：必须包含输出协议规定的全部 XML 标签，包括 grade_semester 年级标签，不要输出其他内容。
2. **纯文本**：内容作为纯文本处理，**不要转义反斜杠**。
3. **题目不变**：不要修改或重复题目内容，只提供答案和解析。
4. **解答完整**：答案要给出每一小问的最终结果；解析要写出完整的解题步骤，不要省略中间推导。
5. **LaTeX 规范**：
${LATEX_RULES}

{{grade_instruction}}
{{provider_hints}}`;

/**
 * 生成重新解题提示词
 * @param language - 语言 ('zh' 或 'en')
 * @param questionText - 校正后的题目文本
 * @param subject - 学科提示（可选）
 * @param options - 自定义选项
 */
export function generateReanswerPrompt(
  language: 'zh' | 'en',
  questionText: string,
  subject?: string | null,
  options?: PromptOptions,
  gradeSemester?: string | null
): string {
  const langInstruction = generateFieldLanguageInstruction(language);

  const subjectHint = subject
    ? `本题学科：${subject}`
    : "请根据题目内容判断学科。";

  const template = options?.customTemplate || DEFAULT_REANSWER_TEMPLATE;

  return replaceVariables(template, {
    language_instruction: langInstruction,
    question_text: questionText,
    subject_hint: subjectHint,
    knowledge_points_rule: options?.candidateTags
      ? `只能从以下${options.candidateTags.subjectName}知识点中选择最多 5 个，清单为空或没有匹配项时留空，必须与名称完全一致，不要改写、不要自创：\n${options.candidateTags.tags.map(tag => `"${tag}"`).join(", ") || '（无可用标签）'}`
      : '',
    grade_instruction: generateGradeInstruction(gradeSemester),
    provider_hints: options?.providerHints || ''
  }).trim() + '\n\n' + [
    '请以校正后的题目文本为准重新解答，图片仅用于补充图形及可见的正式作答，过滤掉草稿与人的思考过程。',
    generateOutputContract('reanswer'), DRAFT_FILTER_RULES, langInstruction, LATEX_RULES,
    generateGradeInstruction(gradeSemester), generateGradeRecognitionInstruction(gradeSemester),
    DIFFICULTY_STARS_RULES, QUESTION_TYPE_RULES,
    options?.candidateTags ? `只能从候选知识点中选择，名称必须完全一致，最多 5 个；无可用标签时留空：${options.candidateTags.tags.join('、')}` : '',
  ].filter(Boolean).join('\n\n');
}

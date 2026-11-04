/**
 * LaTeX 语法修复提示词生成函数
 */

import { LATEX_RULES } from './shared';

/** 修复 LaTeX 时各字段对应的输出标签 */
export const LATEX_FIX_TAGS = {
  questionText: 'question_text',
  answerText: 'answer_text',
  analysis: 'analysis',
  wrongAnswerText: 'wrong_answer_text',
  mistakeAnalysis: 'mistake_analysis',
} as const;

export type LatexFixField = keyof typeof LATEX_FIX_TAGS;

const LATEX_FIX_LABELS: Record<LatexFixField, string> = {
  questionText: '题目',
  answerText: '答案',
  analysis: '解析',
  wrongAnswerText: '错误解答',
  mistakeAnalysis: '错因分析',
};

/**
 * 修复 LaTeX 语法的提示词：只改公式写法，不改内容
 */
export function generateLatexFixPrompt(
  fields: Partial<Record<LatexFixField, { text: string; issues: string[] }>>
): string {
  const entries = (Object.keys(LATEX_FIX_TAGS) as LatexFixField[]).filter((field) => fields[field]);
  const sections = entries.map((field) => {
    const { text, issues } = fields[field]!;
    const tag = LATEX_FIX_TAGS[field];
    return `【${LATEX_FIX_LABELS[field]}】\n检测到的问题：\n${issues.map((issue) => `- ${issue}`).join('\n')}\n原文：\n<${tag}>\n${text}\n</${tag}>`;
  });
  const outputTags = entries.map((field) => `<${LATEX_FIX_TAGS[field]}>\n修复后的完整${LATEX_FIX_LABELS[field]}\n</${LATEX_FIX_TAGS[field]}>`);

  return `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位熟悉 LaTeX 和 KaTeX 的数学编辑。下面的内容中有 LaTeX 公式语法错误，页面无法正常显示。请只修复公式的写法，使其符合规范并能被 KaTeX 渲染。

【修复要求】
- 只修改公式的写法（定界符、命令、括号、环境等），不要改动文字内容、解题思路、数值和答案，不要增删句子，不要重新解题。
- 没有问题的部分保持原样，Markdown 格式（段落、列表、表格）保持不变。
- 修复后必须符合以下规范：
${LATEX_RULES}

${sections.join('\n\n')}

【输出格式】
只输出以下标签，每个标签内是修复后的完整内容，不要用 Markdown 代码块包裹，不要输出其他内容：

${outputTags.join('\n\n')}`;
}

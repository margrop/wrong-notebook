/**
 * 举一反三提示词模板与生成函数
 */

import {
    generateFieldLanguageInstruction,
    generateGradeInstruction,
    generateOutputContract,
    FIGURE_SVG_RULES,
    LATEX_RULES,
    replaceVariables,
} from './shared';
import type { PromptOptions } from './shared';

export const DEFAULT_SIMILAR_TEMPLATE = `你是一位资深的K12教育题目生成专家，具备跨学科的题目创作能力。你的核心任务是**根据以下原题和知识点，举一反三生成高质量教学题目**，帮助学生巩固知识并拓展解题思路。
### 角色定义
1. **学科全能专家**  
   - 精通K12阶段所有学科（数学/语文/英语/物理/化学/生物/历史/地理/政治）
   - 熟悉各年级课程标准与知识点分布
   - 能准确识别题目考察的核心能力点（计算/推理/分析/应用/创新）
2. **题目变异大师**  
   - 掌握12种变式技法：条件替换/情境迁移/问题转化/数据重构/图形变形/角色反转/跨学科融合/难度阶梯/开放拓展/陷阱设计/逆向思维/生活应用
   - 确保变式题目保持原题核心考点，改变题目表现形式
3. **学情分析师**  
   - 预判学生易错点（认知盲区/概念混淆/计算失误/审题偏差）
   - 在变式题目中针对性强化易错点训练
### 执行流程
1. **接收任务**  
	原题: "{{original_question}}"
	{{language_instruction}}
	DIFFICULTY LEVEL: {{difficulty_level}}
	{{difficulty_instruction}}
	Knowledge Points: {{knowledge_points}}  
2. **解构分析**  
   - 提取核心考点与能力要求
   - 分析题目陷阱与解题路径
3.  **质量管控**  
   - 确保每道题：  
     ✓ 覆盖相同核心知识点  
     ✓ 保持解题逻辑一致性  
     ✓ 答案唯一且可验证  
     ✓ 无知识性错误
### 输出规范
你的响应输出**必须严格遵循以下自定义标签格式**。**严禁**使用 JSON 或 Markdown 代码块。**严禁**返回 \`\`\`json ... \`\`\`。

请严格按照以下结构输出内容（不要包含任何其他文字）：

<question_text>
在此处填写新生成的填空题或解答题。不要包含题号、分值或选择题选项。
</question_text>

<answer_text>
在此处填写新题目的正确答案。
</answer_text>

<analysis>
在此处填写新题目的详细解析。
* 解析语言遵循字段语言规则。
* **直接使用标准的 LaTeX 符号**（如 $\\frac{1}{2}$），**不要**进行 JSON 转义。
</analysis>

{{figure_instruction}}

###关键格式与内容约束 (CRITICAL RULES) !!!
1. **纯文本**：内容作为纯文本处理，**不要转义反斜杠**。
2. **LaTeX 规范**：
${LATEX_RULES}

{{grade_instruction}}
{{provider_hints}}`;

/** 举一反三新题的配图要求：原题有配图时，新题按新的数据重新画图 */
function generateSimilarFigureInstruction(originalFigureSvg?: string | null): string {
  const reference = originalFigureSvg
    ? `原题配图如下（SVG），新题若沿用类似图形，必须按新题的条件和数据重新绘制，不要直接照抄：\n${originalFigureSvg}`
    : '原题没有配图；只有新题确实需要图形才能理解时才画图。';
  return `<figure_svg>
如果新题目需要配图，在此处用 SVG 绘制新题目的配图，图中的字母、数字和标注必须与新题目一致：
${FIGURE_SVG_RULES}
${reference}
新题目不需要配图时请留空。
</figure_svg>`;
}

export const GENERATED_QUESTION_RULES = `【生成题目的必守规则（适用于举一反三和试卷生成）】
- 只能生成填空题或解答题，题干直接给出条件和需要填写、计算、说明或证明的要求。
- 题干中不得包含题号、编号标题或分值，例如“第 1 题”“1.”“（5 分）”“Question 1”“[5 marks]”。
- 不得生成选择题、判断题或任何候选选项，包括 A/B/C/D、①②③④、勾选框及作为选项的配图。
- 原题是选择题或判断题时，必须重新设计为可独立作答的填空题或解答题；把解题所需条件写入题干，不得只删除选项而留下“下列哪项正确”等依赖选项的问法。
- answer_text 必须给出具体答案或结论，不能只给选项字母；analysis 给出对应的解题过程。
- 返回前检查题干，删除题号和分值，确认没有选项、答案泄漏或缺失的必要条件。`;

export function generateSimilarQuestionPrompt(
  language: 'zh' | 'en',
  originalQuestion: string,
  knowledgePoints: string[],
  difficulty: 'easy' | 'medium' | 'hard' | 'harder' = 'medium',
  options?: PromptOptions,
  gradeSemester?: string | null
): string {
  const langInstruction = generateFieldLanguageInstruction(language, true);

  const difficultyInstruction = {
    'easy': "Make the new question EASIER than the original. Use simpler numbers and more direct concepts.",
    'medium': "Keep the difficulty SIMILAR to the original question.",
    'hard': "Make the new question HARDER than the original. Combine multiple concepts or use more complex numbers.",
    'harder': "Make the new question MUCH HARDER (Challenge Level). Require deeper understanding and multi-step reasoning."
  }[difficulty];

  const template = options?.customTemplate || DEFAULT_SIMILAR_TEMPLATE;

  const prompt = replaceVariables(template, {
    figure_instruction: generateSimilarFigureInstruction(options?.originalFigureSvg),
    difficulty_level: difficulty.toUpperCase(),
    difficulty_instruction: difficultyInstruction,
    language_instruction: langInstruction,
    original_question: originalQuestion,
    knowledge_points: knowledgePoints.join(", "),
    grade_instruction: generateGradeInstruction(gradeSemester),
    provider_hints: options?.providerHints || ''
  }).trim();
  // 自定义模板也必须遵守统一题型规则。
  return [
    prompt, '必须基于输入的原题和知识点生成一道新题，按指定难度调整，不得直接复述原题。',
    generateOutputContract('similar'), langInstruction, LATEX_RULES,
    generateGradeInstruction(gradeSemester), difficultyInstruction,
    generateSimilarFigureInstruction(options?.originalFigureSvg), GENERATED_QUESTION_RULES,
  ].filter(Boolean).join('\n\n');
}

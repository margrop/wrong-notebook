/**
 * 图片解析（错题识别）提示词模板与生成函数
 */

import type { GradeLevel } from '../types';
import {
    generateFieldLanguageInstruction,
    generateGradeInstruction,
    generateGradeRecognitionInstruction,
    generateOutputContract,
    DRAFT_FILTER_RULES,
    DIFFICULTY_STARS_RULES,
    FIGURE_SVG_RULES,
    LATEX_RULES,
    getMathTagsForGrade,
    replaceVariables,
} from './shared';
import type { PromptOptions } from './shared';

export const DEFAULT_ANALYZE_TEMPLATE = `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位世界顶尖的、经验丰富的、专业的跨学科考试分析专家（Interdisciplinary Exam Analysis Expert）。你的核心任务是极致准确地分析用户提供的考试题目图片，全面理解所有文本、图表和隐含约束，并提供一个完整、高度结构化且专业的解决方案。

{{language_instruction}}

【核心输出要求 (OUTPUT REQUIREMENTS)】
你的响应输出**必须严格遵循以下自定义标签格式**。**严禁**使用 JSON 或 Markdown 代码块。**严禁**对 LaTeX 公式中的反斜杠进行二次转义（如 "\\\\frac" 是错误的，必须是 "\\frac"）。

请严格按照以下结构输出内容：

<subject>
在此处填写学科，必须是以下之一："数学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"。
</subject>

<knowledge_points>
在此处填写知识点，使用逗号分隔，例如：知识点1, 知识点2, 知识点3
</knowledge_points>

<requires_image>
判断这道题是否需要依赖图片才能正确解答。如果题目包含几何图形、函数图像、实验装置图、电路图等必须看图才能理解的内容，填写 true；如果只需要文字描述即可理解（如英语题、纯文字数学题），填写 false。
</requires_image>

<has_figure>
判断题目本身是否带有配图（几何图形、函数图像、示意图、统计图、实验装置图、电路图等；不含学生的作答痕迹和纯文字表格）。有配图填 true，否则填 false。
</has_figure>

<figure_svg>
如果 has_figure 为 true，用 SVG 重新绘制题目配图：
${FIGURE_SVG_RULES}
如果 has_figure 为 false，请留空。
</figure_svg>

<wrong_answer_text>
如果图片中包含学生针对本题提交的正式错误答案或正式解题步骤，请按原样摘录；必须过滤掉空白处或题干旁的草稿、竖式演算、试算数字、涂改痕迹、审题圈画以及人的思考过程批注。如果图片中只有草稿/思考痕迹或没有看到正式错误解答，请留空。
</wrong_answer_text>

<mistake_status>
填写以下值之一：wrong_attempt（图片中有明确的正式错误答案或正式错误步骤；仅有草稿、涂改或思考批注不算作答）、not_attempted（没有正式错误解答，像是不会做、未作答或仅有草稿/思考痕迹）、unknown（无法判断）。
</mistake_status>

<difficulty_stars>
只填写 1 到 5 之间的一个整数，表示题目难度星级。
${DIFFICULTY_STARS_RULES}
</difficulty_stars>

<mistake_analysis>
如果图片中包含学生的正式错误解答，请分析错误可能发生在哪一步、为什么错、导致了什么后果；必须忽略零散草稿和人的思考过程，如果没有正式错误解答，请留空。
</mistake_analysis>

<question_text>
在此处填写题目的完整文本。使用 Markdown 格式。所有数学公式使用 LaTeX 符号（行内 $...$，块级 $$...$$）。

【题干转录规则】
1. **逐字照录**：只按图片原题转录题干（含题号、分值和标点），不要改写、概括、增删字词或调整语序；看不清的字用 [?] 标注。
2. **过滤草稿与思考过程**：必须过滤掉图片中人的手写草稿、竖式演算、试算算式、思考过程批注、审题圈画、涂改痕迹以及学生在横线或括号中填入的答案，严禁将草稿或人的思考过程记录进 question_text。
3. **填空统一**：所有填空处（含已被学生手写填入答案的横线）统一还原写作 ____（4 个下划线），不论原图横线长短。
4. **选择题选项另起一行**：如果题目是选择题，题干与选项必须分行，选项必须在题干下方另起新行书写（不要将选项紧接在题干同一行后面）。
5. **图形描述**：如果题目依赖图形，在题干原文之后空一行，单独写**一段**以「图示：」开头的图形描述；只能使用「图示：」这一种写法（不要写「图示信息」「图示说明」等），描述中不要重复题干已有的文字，且不要包含学生的手写草稿或作答痕迹。题目不依赖图形时不要写图示段落。

【表格处理规则】
如果图片中包含表格，必须完整转录表格内容，遵循以下原则：

1. **标准表格**：使用 Markdown 表格语法
   | 列标题1 | 列标题2 | 列标题3 |
   |---------|---------|---------|
   | 数据1   | 数据2   | 数据3   |

2. **复杂表格**（合并单元格/多级表头/不规则布局）：
   - 优先尝试用 Markdown 表格近似表示
   - 如果 Markdown 无法准确表达，在表格前用文字说明结构，然后用简化的 Markdown 表格 + 注释
   - 示例：
     > 注：第1行为主标题，横跨3列；第2-3行为数据行

     | 项目 | 数值A | 数值B |
     |------|-------|-------|
     | 测试1 | 10 | 20 |
     | 测试2 | 15 | 25 |

3. **表格完整性要求**：
   - 必须转录所有单元格内容（包括空单元格用 - 或空格表示）
   - 保留表格标题、单位、注释
   - 保留数据的对齐关系和分组信息
   - 表格中的数学公式使用 LaTeX 语法

4. **表格上下文**：
   - 如果表格有标题或编号（如"表1"），保留在表格前
   - 如果表格后有注释或说明，保留在表格后
   - 保持表格在题目中的位置关系

5. **特殊情况处理**：
   - 图表混合：如果表格旁边有图形，用文字说明位置关系
   - 手写表格：尽力识别手写内容，不确定的用 [?] 标注
   - 模糊表格：如果表格不清晰，在表格前注明"（表格内容可能不完整）"
</question_text>

<answer_text>
在此处填写正确答案。使用 Markdown 和 LaTeX 符号。如果答案包含表格，遵循上述【表格处理规则】。
</answer_text>

<analysis>
在此处填写详细的步骤解析。
* 解析语言遵循字段语言规则。
* **直接使用标准的 LaTeX 符号**（如 $\\frac{1}{2}$），**不要**进行 JSON 转义（不要写成 \\\\frac）。
* 如果解析过程需要表格（如列表对比、分步计算表），遵循上述【表格处理规则】。
</analysis>

【知识点标签列表（KNOWLEDGE POINT LIST）】
{{knowledge_points_list}}

【标签使用规则 (TAG RULES)】
- 标签必须与题目实际考查的知识点精准匹配。
- 每题最多 5 个标签。

【!!! 关键格式与内容约束 (CRITICAL RULES) !!!】
1. **格式严格**：必须包含输出协议规定的全部 XML 标签，包括 grade_semester 年级标签，不要输出任何“开场白”或“结束语”。
2. **纯文本**：内容作为纯文本处理，**不要转义反斜杠**。
3. **内容完整**：如果包含子问题，请在 question_text 中完整列出。
4. **禁止图片**：严禁包含任何图片链接或 markdown 图片语法。
5. **LaTeX 规范**：
${LATEX_RULES}

{{grade_instruction}}
{{provider_hints}}`;

/**
 * Generates the analyze image prompt
 * @param language - Target language for analysis ('zh' or 'en')
 * @param grade - Optional grade level (7-9:初中, 10-12:高中) for cumulative tag filtering
 * @param options - Optional customizations
 */
export function generateAnalyzePrompt(
  language: 'zh' | 'en',
  grade?: GradeLevel | null,
  subject?: string | null,
  options?: PromptOptions,
  gradeSemester?: string | null
): string {
  const langInstruction = generateFieldLanguageInstruction(language);

  // 获取各学科标签（优先使用预获取的数据库标签）
  const mathTags = getMathTagsForGrade(grade || null, options?.prefetchedMathTags);
  const mathTagsString = mathTags.length > 0 ? mathTags.map(tag => `"${tag}"`).join(", ") : '（无可用标签）';

  const physicsTags = options?.prefetchedPhysicsTags || [];
  const physicsTagsString = physicsTags.length > 0 ? physicsTags.map(tag => `"${tag}"`).join(", ") : '（无可用标签）';

  const chemistryTags = options?.prefetchedChemistryTags || [];
  const chemistryTagsString = chemistryTags.length > 0 ? chemistryTags.map(tag => `"${tag}"`).join(", ") : '（无可用标签）';

  const biologyTags = options?.prefetchedBiologyTags || [];
  const biologyTagsString = biologyTags.length > 0 ? biologyTags.map(tag => `"${tag}"`).join(", ") : '（无可用标签）';

  const englishTags = options?.prefetchedEnglishTags || [];
  const englishTagsString = englishTags.length > 0 ? englishTags.map(tag => `"${tag}"`).join(", ") : '（无可用标签）';

  // 根据科目决定显示哪些标签（节省 token，提高准确性）
  let tagsSection = "";

  if (options?.candidateTags) {
    const { subjectName, tags } = options.candidateTags;
    tagsSection = `**${subjectName}标签:**
本题所在错题本的学段与学科下的全部知识点如下，请使用其中的**精确标签名称**：
${tags.length > 0 ? tags.map(tag => `"${tag}"`).join(", ") : '（无可用标签）'}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签，不要改写、不要自创
- 每题最多 5 个标签`;
  } else if (subject === '数学') {
    tagsSection = `**数学标签 (Math Tags):**
使用课程大纲（人教版课内知识点，小学另含高思竞赛数学课外拓展知识点）中的**精确标签名称**，可选标签如下：
${mathTagsString}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签
- 每题最多 5 个标签`;
  } else if (subject === '物理') {
    tagsSection = `**物理标签 (Physics Tags):**
使用课程大纲中的**精确标签名称**，可选标签如下：
${physicsTagsString}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签
- 每题最多 5 个标签`;
  } else if (subject === '化学') {
    tagsSection = `**化学标签 (Chemistry Tags):**
使用课程大纲中的**精确标签名称**，可选标签如下：
${chemistryTagsString}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签
- 每题最多 5 个标签`;
  } else if (subject === '生物') {
    tagsSection = `**生物标签 (Biology Tags):**
使用课程大纲中的**精确标签名称**，可选标签如下：
${biologyTagsString}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签
- 每题最多 5 个标签`;
  } else if (subject === '英语') {
    tagsSection = `**英语标签 (English Tags):**
使用课程大纲中的**精确标签名称**，可选标签如下：
${englishTagsString}

**重要提示**：
- 必须从上述列表中选择精确匹配的标签
- 每题最多 5 个标签`;
  } else {
    // 未知科目：显示所有标签让 AI 判断
    tagsSection = `**数学标签 (Math Tags):**
${mathTagsString}

**物理标签 (Physics Tags):**
${physicsTagsString}

**化学标签 (Chemistry Tags):**
${chemistryTagsString}

**生物标签 (Biology Tags):**
${biologyTagsString}

**英语标签 (English Tags):**
${englishTagsString}`;
  }

  const template = options?.customTemplate || DEFAULT_ANALYZE_TEMPLATE;

  return replaceVariables(template, {
    language_instruction: langInstruction,
    knowledge_points_list: tagsSection,
    grade_instruction: generateGradeInstruction(gradeSemester),
    provider_hints: options?.providerHints || ''
  }).trim() + '\n\n' + [
    '请完整识别用户图片中的题目、独立求解，并仅根据可见的正式作答分析错因，过滤掉草稿与人的思考过程。',
    generateOutputContract('analyze'), DRAFT_FILTER_RULES, langInstruction, LATEX_RULES,
    generateGradeInstruction(gradeSemester), generateGradeRecognitionInstruction(gradeSemester),
    tagsSection, DIFFICULTY_STARS_RULES,
    '有配图时必须输出 figure_svg；无配图时留空。' + FIGURE_SVG_RULES,
  ].filter(Boolean).join('\n\n');
}

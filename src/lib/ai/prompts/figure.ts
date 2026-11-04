/**
 * 单独重绘题目配图提示词模板与生成函数
 */

import { FIGURE_SVG_RULES, replaceVariables } from './shared';

/**
 * 单独为已有题目重绘配图的提示词（详情页「AI 重新生成配图」）
 */
export const DEFAULT_FIGURE_TEMPLATE = `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位擅长绘制试题插图的老师。请观察用户提供的题目图片，判断题目是否带有配图；如果有，用 SVG 精确地重新绘制该配图。

【题目文字（供参考，用于核对图中标注）】
{{question_text}}

【输出格式】
只输出以下两个标签，不要输出其他内容：

<has_figure>
题目本身是否带有配图（几何图形、函数图像、示意图、统计图、实验装置图、电路图等；不含学生的作答痕迹和纯文字表格）。有配图填 true，否则填 false。
</has_figure>

<figure_svg>
如果 has_figure 为 true，用 SVG 重新绘制题目配图：
${FIGURE_SVG_RULES}
如果 has_figure 为 false，请留空。
</figure_svg>`;

/**
 * 生成单独重绘配图的提示词
 */
export function generateFigurePrompt(questionText?: string | null): string {
  return replaceVariables(DEFAULT_FIGURE_TEMPLATE, {
    question_text: questionText?.trim() || '（无题目文字）',
  }).trim();
}

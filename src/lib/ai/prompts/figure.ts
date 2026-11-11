/**
 * 题目配图重绘提示词模板与生成函数：识别后的配图重绘、详情页「AI 重新生成配图」、XML 修复与比对校正
 */

import { FIGURE_SVG_RULES, replaceVariables } from './shared';

/** 发给模型的配图图片尺寸：已知时 SVG 坐标与图片像素一一对应 */
export interface FigureCanvas {
  width: number;
  height: number;
  /** 图片是否为从题目图片中裁剪出的配图区域 */
  cropped: boolean;
}

/**
 * 提高重绘准确度的规则：模型一次性凭印象画图时，最常错的是箭头方向、连线断开和标注错位
 */
export const FIGURE_ACCURACY_RULES = `- 箭头方向必须与原图一致：画每个箭头前对照原图确认起点和终点，箭头标记（marker-end）画在终点一端。化学、物理等示意图中的箭头和连线表示物质转化、电流或运动方向，画反会改变题意。
- 相连的线段必须共用同一端点坐标；带转折的连线用一条 <polyline> 画完，不要断开或错开。
- 文字标注放在原图中对应的位置，紧挨它所标注的线、箭头或区域，不要与线条重叠；化学式等下标用 <tspan baseline-shift="sub"> 或 Unicode 下标字符（₀₁₂₃₄₅₆₇₈₉）。
- 不要增加原图没有的元素，也不要遗漏原图中的线、箭头、虚线和标注。`;

/** 画布说明：已知图片尺寸时要求 viewBox 与像素一致，模型可直接按像素位置取坐标 */
function canvasInstruction(canvas?: FigureCanvas | null): string {
  if (!canvas) return '按原图比例与相对位置绘制。';
  const scope = canvas.cropped ? '（已从题目图片中裁剪出配图区域）' : '';
  return `图片宽 ${canvas.width} 像素、高 ${canvas.height} 像素${scope}。SVG 必须使用 viewBox="0 0 ${canvas.width} ${canvas.height}"，按图中元素的像素位置取坐标（与图片像素一一对应），字号与原图文字大小一致；本条优先于下文的 viewBox 宽度与字号建议。`;
}

/**
 * 重绘配图的提示词：先在 figure_outline 中列出元素与坐标，再据此输出 SVG
 */
export const DEFAULT_FIGURE_TEMPLATE = `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位擅长绘制试题插图的老师。请观察用户提供的题目图片，判断题目是否带有配图；如果有，用 SVG 精确地重新绘制该配图。

【题目文字（供参考，用于核对图中标注）】
{{question_text}}

【画布】
{{canvas_instruction}}

【输出格式】
按顺序只输出以下三个标签，不要输出其他内容：

<has_figure>
题目本身是否带有配图（几何图形、函数图像、示意图、统计图、实验装置图、电路图等；不含学生的作答痕迹和纯文字表格）。有配图填 true，否则填 false。
</has_figure>

<figure_outline>
如果 has_figure 为 true，先对照图片逐项列出配图中的全部元素，再据此绘制 SVG：
1. 外框、容器、坐标轴等主体结构及其坐标；
2. 每条线段或折线：按顺序写出全部端点坐标，注明实线或虚线、与哪些元素相连；
3. 每个箭头：写出起点和终点坐标及指向，例如「从 (430,214) 向左指到 (225,214)」；
4. 每个文字标注：内容、坐标，以及它紧挨哪条线、哪个箭头或哪个区域。
如果 has_figure 为 false，请留空。
</figure_outline>

<figure_svg>
如果 has_figure 为 true，严格按 figure_outline 用 SVG 重新绘制配图：
${FIGURE_SVG_RULES}
${FIGURE_ACCURACY_RULES}
如果 has_figure 为 false，请留空。
</figure_svg>`;

/**
 * 生成重绘配图的提示词；canvas 为发给模型的图片尺寸，未知时只要求按比例绘制
 */
export function generateFigurePrompt(questionText?: string | null, canvas?: FigureCanvas | null): string {
  return replaceVariables(DEFAULT_FIGURE_TEMPLATE, {
    question_text: questionText?.trim() || '（无题目文字）',
    canvas_instruction: canvasInstruction(canvas),
  }).trim();
}

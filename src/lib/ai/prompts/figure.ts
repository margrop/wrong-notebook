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

/**
 * 修正不合法 SVG 的提示词：只修语法，不改图形内容
 */
export function generateFigureFixPrompt(figureSvg: string, xmlError: string): string {
  return `【任务】
你上一次输出的题目配图 SVG（${figureSvg}）不是合法 XML，浏览器无法显示。XML 解析错误（${xmlError}）给出了出错的行列号。
请只修正语法错误（如重复属性、未闭合或交错的标签、未转义的 & 与 <、未声明的命名空间前缀），不要改动图形内容和坐标。

【输出格式】
只输出以下标签，不要输出其他内容：
<figure_svg>
修正后的完整 SVG：
${FIGURE_SVG_RULES}
</figure_svg>`;
}

/**
 * 比对校正提示词：图片左半为原配图、右半为 SVG 渲染结果，让模型找出差异并输出修正后的 SVG
 */
export function generateFigureReviewPrompt(questionText: string, figureSvg: string, canvas: FigureCanvas): string {
  const { width, height } = canvas;
  return `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位试题插图校对老师。用户图片由左右两半并排组成，中间以灰色竖条分隔：左半是题目原图中的配图，右半是按 SVG 源码（${figureSvg}）渲染出的重绘结果。两半尺寸相同（各宽 ${width} 像素、高 ${height} 像素），坐标一一对应：SVG 中的点 (x, y) 画在右半的 (x, y) 处，左半同一位置就是原图的对应位置。请逐项比对，找出重绘与原图不一致的地方并修正 SVG。

【题目文字（供参考，用于核对图中标注）】
${questionText}

【比对要点】
- 箭头：数量、起止位置与指向是否与原图一致；
- 线条：是否连通、端点位置、实线或虚线，有无缺失或多余；
- 主体结构：外框、容器、坐标轴等的位置与比例；
- 文字标注：内容与位置。右半中的文字可能因服务器缺少字体显示为方框或空白，文字内容以 SVG 源码为准，只核对位置。

【输出格式】
按顺序只输出以下两个标签，不要输出其他内容：

<figure_differences>
先逐个对照箭头：按「左半：位置、指向 / 右半：位置、指向」列出原图中的每个箭头和重绘中对应的箭头，指向不同的标为不一致；
再逐条列出其他不一致之处，写清位置和应如何修改。没有任何不一致时最后写「无」。
</figure_differences>

<figure_svg>
有不一致时，在原 SVG 基础上修改后输出完整 SVG，viewBox 保持 "0 0 ${width} ${height}" 不变，没有出错的部分保持原样：
${FIGURE_SVG_RULES}
${FIGURE_ACCURACY_RULES}
完全一致时留空。
</figure_svg>`;
}

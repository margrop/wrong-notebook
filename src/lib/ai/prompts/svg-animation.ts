/**
 * SVG 动画讲解提示词模板与生成函数
 */

import { embedNarration, getSvgAnimationDuration } from '../../svg-animation';
import { replaceVariables } from './shared';

/**
 * SVG 动画讲解提示词（详情页「生成动画讲解」）
 */
export const DEFAULT_SVG_ANIMATION_TEMPLATE = `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位擅长用动画讲题的老师。请为下面这道题制作一段 SVG 动画讲解：按解题思路分步骤演示，让学生看完动画就能理解这道题怎么做。

【题目内容 (QUESTION)】
{{question_text}}

【答案内容 (ANSWER)】
{{answer_text}}

【解析内容 (ANALYSIS)】
{{analysis}}

{{figure_reference}}

【动画要求】
- 分 3~6 个步骤，每步 4~6 秒，总时长不超过 40 秒；动画只播放一遍，全部元素使用 fill="freeze"，结束时停在完整的解题结论画面。
- 每一步在画面底部的字幕区显示该步的讲解文字（{{subtitle_rule}}），进入下一步时替换为新字幕。
- {{language_instruction}}
- 画面与讲解同步：逐步画出辅助线、标出已知条件、高亮正在讲解的部分、移动或变换图形、写出关键算式。几何题按题目条件画图；非几何题用线段图、数轴、表格、示意图或算式推导等合适的形式。
- 用 SMIL 动画（<animate>、<set>、<animateTransform>、<animateMotion>）实现，用 begin 属性按时间排列（如 begin="4s"）；需要先隐藏的元素设 opacity="0" 再用 <animate> 或 <set> 显示。
- 公式不要用 LaTeX，用普通文字和 Unicode 符号（如 x²、√2、π、×、÷、≤、≥、∠、△、⊥、∥）。
- 输出一个完整的 <svg> 元素，包含 xmlns="http://www.w3.org/2000/svg" 和 viewBox="0 0 800 500"，第一个元素是铺满画面的白色背景 rect；文字用 <text>（font-family="sans-serif"，正文 font-size 18~22），线条为黑色，高亮可用红色 #e53935、蓝色 #1e88e5、绿色 #43a047。
- 语音讲解稿：在 <svg> 开头放一个 <metadata id="narration">，内容为 JSON 数组，每个步骤一项 {"begin": 该步开始的秒数, "text": "朗读的讲解"}，begin 与该步字幕出现的时间一致。{{narration_rule}}讲解要口语化、比字幕更完整，朗读时长与该步时长相近；符号写成读法（如“x 的平方”“根号 2”“角 ABC”），不要写 <、>、& 字符。
- 只使用基本图形元素：line、polyline、polygon、rect、circle、ellipse、path、text、tspan、g、defs、marker、metadata 以及上述动画元素。
- 代码保持精简：坐标取整数，相同样式放在 <g> 上统一设置，不要重复绘制相同的元素，整个 SVG 控制在 15000 个字符以内。
- 严禁使用 <image>、<script>、<foreignObject>、外部链接、外部字体或事件属性。

【输出格式】
只输出以下标签，不要用 Markdown 代码块包裹，不要输出其他内容：

<svg_animation>
完整的 SVG 动画
</svg_animation>`;

/** 语音讲解稿的语言与长度要求（按每秒约 4 个汉字或 2.5 个英文单词估算） */
const NARRATION_RULES: Record<'zh' | 'en', string> = {
    zh: '讲解使用简体中文，按该步时长每秒约 4 个字（如 5 秒的步骤约 20 字）。',
    en: 'Write the narration in English, about 2.5 words per second of the step (e.g. about 12 words for a 5-second step).',
};

/** 生成 SVG 动画讲解时随提示词发送的用户消息 */
export const SVG_ANIMATION_REQUEST: Record<'zh' | 'en', string> = {
    zh: '请为上述题目制作 SVG 动画讲解。',
    en: 'Please create the SVG animated explanation for the question above, with all text in English.',
};

/**
 * 生成 SVG 动画讲解提示词；figureSvg 为题目配图，动画据此作图；language 决定动画中文字的语言
 */
export function generateSvgAnimationPrompt(
    questionText: string,
    answerText: string,
    analysis: string,
    figureSvg?: string | null,
    language: 'zh' | 'en' = 'zh'
): string {
    return replaceVariables(DEFAULT_SVG_ANIMATION_TEMPLATE, {
        subtitle_rule: language === 'en'
            ? '英文，每行不超过 48 个字符，最多两行'
            : '简体中文，每行不超过 24 个字，最多两行',
        narration_rule: NARRATION_RULES[language],
        language_instruction: language === 'en'
            ? 'IMPORTANT: All text in the animation (title, labels, table headers, subtitles and conclusions) must be in English. If the question, answer or analysis is in Chinese, translate it into natural English; keep names of points, variables and numbers unchanged.'
            : '动画中的全部文字（标题、标注、表头、字幕和结论）使用简体中文；题目为英文时，题目原文中的专有名词与变量可保留英文。',
        question_text: questionText.trim() || '（无题目文字）',
        answer_text: answerText.trim() || '（无）',
        analysis: analysis.trim() || '（无）',
        figure_reference: figureSvg ? `【题目配图 (FIGURE)】\n题目配图如下（SVG），动画中的图形须与之一致：\n${figureSvg}` : '',
    }).trim();
}

/**
 * 为已有的 SVG 动画补写语音讲解稿的提示词（画面不变，只输出讲解稿）
 */
export const DEFAULT_SVG_NARRATION_TEMPLATE = `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位擅长讲题的老师。下面是一道题和已经做好的 SVG 动画讲解（SMIL 动画{{duration_hint}}）。请为这段动画写语音讲解稿：按动画的步骤和时间，写出每一步要朗读的讲解，让学生边看动画边听讲解。

【题目内容 (QUESTION)】
{{question_text}}

【答案内容 (ANSWER)】
{{answer_text}}

【解析内容 (ANALYSIS)】
{{analysis}}

【SVG 动画 (ANIMATION)】
{{svg_animation}}

【讲解稿要求】
- 根据动画中各元素的 begin 时间找出每一步的开始时间（通常是该步字幕出现的时间），每一步写一段，begin 与之一致，第一段 begin 为 0。
- 讲解内容与该步画面一致，口语化、比字幕更完整，朗读时长与该步时长相近。{{narration_rule}}
- 符号写成读法（如“x 的平方”“根号 2”“角 ABC”），不要使用 LaTeX，不要写 <、>、& 字符。

【输出格式】
只输出以下标签，标签内是 JSON 数组，不要用 Markdown 代码块包裹，不要输出其他内容：

<narration>
[{"begin": 0, "text": "第一步的讲解"}, {"begin": 5, "text": "第二步的讲解"}]
</narration>`;

/** 补写讲解稿时随提示词发送的用户消息 */
export const SVG_NARRATION_REQUEST: Record<'zh' | 'en', string> = {
    zh: '请为上述动画写语音讲解稿。',
    en: 'Please write the voice narration for the animation above, in English.',
};

/**
 * 补写语音讲解稿的提示词；svgAnimation 为已有动画（会去掉其中旧的讲解稿），language 决定讲解的语言
 */
export function generateSvgNarrationPrompt(
    questionText: string,
    answerText: string,
    analysis: string,
    svgAnimation: string,
    language: 'zh' | 'en' = 'zh',
    durationSeconds?: number
): string {
    const duration = Math.round(durationSeconds ?? getSvgAnimationDuration(svgAnimation));
    return replaceVariables(DEFAULT_SVG_NARRATION_TEMPLATE, {
        duration_hint: duration > 0 ? `，总时长约 ${duration} 秒` : '',
        narration_rule: NARRATION_RULES[language],
        question_text: questionText.trim() || '（无题目文字）',
        answer_text: answerText.trim() || '（无）',
        analysis: analysis.trim() || '（无）',
        svg_animation: embedNarration(svgAnimation, null),
    }).trim();
}

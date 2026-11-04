/**
 * 分题提示词模板与生成函数
 */

/** 分题输出协议的标题，同时用于日志与测试中区分分题请求 */
export const QUESTION_SPLIT_CONTRACT_TITLE = '【分题输出协议】';

const QUESTION_SPLIT_RULES = `【什么算一道题】
- 一道题 = 一个顶层题号（如 1．2．3．、第 1 题、Question 1）及其全部内容：题干、选项（A/B/C/D）、小问（(1)(2)、①②）、配图、表格、空格与单位。
- 选项和小问永远留在所属题内，不要单独成题；没有题号但内容完整独立的题，也各自算一道。
- 标题、姓名/班级/日期/得分栏、页眉页脚、「共 N 题」「做完再看答案」等说明、答案页，不算题目。
- 阅读材料、题组说明、公共表格（如「阅读下面的短文，完成 1～3 题」）是这几道题的公共材料，不单独成题，也不要丢弃。
- 大题分组标题（如「一、选择题（每题 2 分）」）只作为 section，不算题目。
- 只根据实际内容判断，看不清的文字不要猜测或编造。`;

export const DEFAULT_SPLIT_TEXT_TEMPLATE = `【角色与核心任务】
你是试卷整理助手。输入是一段按行编号的试题文字（data.lines，每项含行号 n 和该行文字 text），可能包含多道题。请把它分成若干道独立的题目。

${QUESTION_SPLIT_RULES}

${QUESTION_SPLIT_CONTRACT_TITLE}
只输出一个 JSON 对象，不要输出其他文字：
{"questions":[{"label":"1","lines":[起始行号,结束行号],"material":[起始行号,结束行号] 或 null,"section":"所属大题标题" 或 null}]}
- lines 为这道题占用的连续行（包含首尾行，行号从 1 开始），按原文顺序输出，不同题的 lines 不得重叠。
- material 为这道题使用的公共材料所在的连续行；没有时为 null。多道题可以引用同一段材料。
- label 为原文题号（不含标点），没有题号时为 null。
- 不要输出题目文字，不要改写、翻译或补全任何内容。`;

export const DEFAULT_SPLIT_IMAGE_TEMPLATE = `【角色与核心任务】
你是试卷整理助手。请观察用户提供的试卷或作业照片，找出图中的每一道题，并给出每道题在图中的位置。

${QUESTION_SPLIT_RULES}
- 题目的配图（几何图形、函数图像、示意图、表格）属于对应的题，区域必须把配图一起框进去。
- 学生的手写作答、批改痕迹不影响分题。

${QUESTION_SPLIT_CONTRACT_TITLE}
只输出一个 JSON 对象，不要输出其他文字：
{"quality":"clear|blurry|partial","questions":[{"label":"1","text":"题目文字","regions":[{"x":0,"y":0,"w":0,"h":0}],"hasFigure":false,"unclear":false,"partial":false,"section":null}]}
- 坐标以整张图片左上角为原点，宽、高都按 1000 归一化（x、y、w、h 取 0～1000 的整数）；区域要完整包含题号、题干、选项、小问和配图，可略微留白。
- 一道题跨栏或跨区域时，regions 可给出多个矩形（最多 4 个）；确实无法定位时 regions 为空数组，不要编造位置。
- text 为题目文字的忠实转写（公式用 LaTeX，$...$ 包裹）；看不清的部分不要猜测，并把 unclear 设为 true。
- 题目被照片边缘截断时 partial 设为 true；hasFigure 表示题目带配图。
- quality：图片清晰为 clear，整体模糊为 blurry，只拍到部分试卷为 partial。
- 按题目在试卷上的阅读顺序输出。`;

/** 分题提示词（文字按行号分题，图片识别题目与区域）；题目文字始终保持原文语言，界面语言只影响后续解析 */
export function generateQuestionSplitPrompt(kind: 'text' | 'image'): string {
  const template = kind === 'text' ? DEFAULT_SPLIT_TEXT_TEMPLATE : DEFAULT_SPLIT_IMAGE_TEMPLATE;
  return `${template}\n题目文字保持原文语言，不要翻译。`;
}

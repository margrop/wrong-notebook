/**
 * GeoGebra 动态演示生成提示词模板与生成函数
 */

import { GEOGEBRA_DRAWING_COMMANDS, GEOGEBRA_API_METHODS } from '../../geogebra-commands';
import { replaceVariables } from './shared';

/**
 * GeoGebra 动态演示生成提示词
 * 用于判断题目是否可以用 GeoGebra 演示，以及生成对应的 GeoGebra 命令
 */
export const DEFAULT_GEOGEBRA_PROMPT = `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位专业的 GeoGebra 数学可视化专家。你的任务是分析一道数学题目，判断它是否适合用 GeoGebra 进行动态可视化演示。如果适合，生成可以直接在 GeoGebra 中执行的命令。

【题目内容 (QUESTION)】
{{question_text}}

【答案内容 (ANSWER)】
{{answer_text}}

【解析内容 (ANALYSIS)】
{{analysis}}

{{error_feedback}}

【判断标准 (SUITABILITY CRITERIA)】
适合用 GeoGebra 演示的题目类型：
1. **函数与图像**：一次函数、二次函数、反比例函数、指数函数、对数函数、三角函数等
2. **几何图形**：三角形、四边形、圆、直线关系（平行、垂直）、角度
3. **解析几何**：直线方程、圆的方程、椭圆、双曲线、抛物线
4. **向量**：向量运算、向量的几何表示
5. **概率统计**：数据分布图、正态分布曲线
6. **不等式**：线性规划、可行域
7. **立体几何**（部分可演示）：截面、展开图

不适合用 GeoGebra 演示的题目类型：
1. 纯文字推理题、证明题（无图形元素）
2. 纯计算题（如解方程、化简表达式）
3. 概念辨析题、选择题（无几何内容）
4. 英语、语文、历史等非理科题目
5. 概率计算（无图形意义的）
6. 数列通项公式推导（无图形意义的）

【GeoGebra 命令规范 (COMMAND SYNTAX)】
绘图指令只能从以下清单选择（以及已定义函数的调用）：${GEOGEBRA_DRAWING_COMMANDS.join("、")}。
Applet API 仅支持：${GEOGEBRA_API_METHODS.join("、")}。
每个数组元素只放一条命令；API 参数只能是数字、布尔值、双引号字符串及数组，不得传入表达式或脚本。
允许 Text 的字符串和数学比较符 <、>，不允许 HTML 标记、外部链接、JavaScript、Execute 或运行脚本的指令。
如果适合演示，生成 GeoGebra 命令数组。每条命令一行，支持以下类型：

**GeoGebra 绘图命令（通过 evalCommand 执行）：**
- 函数：f(x) = x^2
- 点：A = (1, 2)
- 直线：line: y = 2x + 1  或  Line(A, B)
- 线段：Segment(A, B)
- 圆：Circle(A, 3)  或  c: (x-1)^2 + (y-2)^2 = 9
- 椭圆：Ellipse(F1, F2, 5)
- 多边形：Polygon(A, B, C)
- 交点：Intersect(f, g, 1)  或  Intersect(f, g, x1, x2)
- 中点：Midpoint(A, B)
- 垂线：PerpendicularLine(P, l)
- 平行线：Line(P, l)
- 角度：Angle(A, B, C)
- 文本：Text("说明文字", (x, y))
- 滑动条：a = Slider(-5, 5, 0.1)
- 轨迹：Locus(P, Q)
- 反射：Reflect(A, l)
- 平移：Translate(A, v)
- 旋转：Rotate(A, angle, center)

**Applet API 设置命令（通过 applet 方法直接调用）：**
- setCoordSystem(-10, 10, -10, 10)  -- 设置坐标范围
- setAxesVisible(true, true)  -- 显示/隐藏坐标轴
- setGridVisible(true)  -- 显示/隐藏网格
- setColor("对象名", R, G, B)  -- 设置颜色 (0-255)
- setLineThickness("对象名", 3)  -- 设置线宽
- setLineStyle("对象名", 1)  -- 0=实线, 1=虚线
- setPointSize("对象名", 5)  -- 设置点大小
- setPointStyle("对象名", 4)  -- 点样式 (3-8)
- setLabelVisible("对象名", true)  -- 显示/隐藏标签
- setCaption("对象名", "LaTeX标签")  -- 设置标签文本
- setFilling("对象名", 0.3)  -- 设置填充透明度 (0-1)

【输出格式 (OUTPUT FORMAT)】
你的响应必须**只有以下 JSON 格式**，不要包含其他任何文字：

如果题目**适合**用 GeoGebra 演示：
{"suitable": true, "commands": ["命令1", "命令2", "命令3", ...], "description": "简要说明演示内容"}

如果题目**不适合**用 GeoGebra 演示：
{"suitable": false, "commands": [], "description": "不适合原因简述"}

【!!! 关键约束 (CRITICAL RULES) !!!】
1. 输出必须是合法的 JSON，不要添加 markdown 代码块标记
2. commands 数组中的每条命令必须是 GeoGebra 可直接执行的语法
3. setCoordSystem 应根据题目内容合理设置坐标范围
4. 所有图形对象应设置合适的颜色和样式以便于观察
5. 确保坐标范围能让所有关键图形和交点清晰可见
6. description 用简体中文
7. 如果题目涉及参数讨论（如讨论 a 的取值范围），用滑动条 (Slider) 展示参数变化效果
8. 对于函数题，应画出函数图像并标注关键点（交点、顶点、渐近线等）
9. 【!!! 命令语法检查 (COMMAND SYNTAX CHECK) !!!】在生成命令后，必须逐条检查以下内容：
   a. 每个变量在使用前必须已被定义（例如如果使用 F = Intersect(f, g)，则 f 和 g 必须在之前已定义）
   b. 所有命令名称必须是 GeoGebra 官方支持的指令（平行线使用 Line(P, l)）
   c. 命令顺序必须合理：先定义基础对象（点、线、函数），再定义派生对象（交点、轨迹、变换）
   d. 每个命令的语法必须正确（参数数量、类型、顺序与 GeoGebra 官方文档一致）
   e. 如果使用了循环或条件语句，确保语法正确
   f. 坐标轴范围 (setCoordSystem) 必须在所有绘图命令之前设置`;

/**
 * 生成 GeoGebra 分析提示词
 */
export function generateGeogebraPrompt(
    questionText: string,
    answerText: string,
    analysis: string,
    previousErrors?: string
): string {
    return replaceVariables(DEFAULT_GEOGEBRA_PROMPT, {
        question_text: questionText,
        answer_text: answerText,
        analysis,
        error_feedback: previousErrors?.trim() ? `【上次执行错误 (PREVIOUS ERRORS)】\n上次生成的 GeoGebra 命令执行时出现了以下错误，请分析错误原因并在这次生成中修正：\n${previousErrors}\n\n【错误修正要求 (ERROR FIX RULES)】\n请严格按以下步骤修正：\n1. 检查每条失败命令，确认是语法错误、变量未定义还是命令名称错误\n2. 如果是"未定义变量X"，在命令之前添加定义该变量的命令，或调整命令顺序\n3. 如果是"未知的指令"，替换为 GeoGebra 官方支持的等效命令（平行线使用 Line(P, l)）\n4. 重新排列所有命令的顺序，确保每个对象在使用前已定义\n5. 生成后再次逐条检查：每条命令的语法、变量引用、依赖关系是否正确` : '',
    });
}

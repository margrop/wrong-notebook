# 题目交换格式 JSON v1（QUESTION_FORMAT）

本文档定义 wrong-notebook 对外的**题目交换格式 JSON v1**：用于 JSON 文件导入导出、Agent 提交题目、以及与其他项目互通。

- 实现位置：`src/lib/question-format/`（纯函数库，浏览器与服务端均可用）
- JSON Schema：`doc/schemas/questions-v1.schema.json`（draft 2020-12）
- 完整示例：`doc/schemas/questions-v1.example.json`

## 从错题本导出

错题本的多选栏提供导出功能（`POST /api/error-items/export-questions`），对话框中可选择三种格式：**JSON / Excel / Word**。所有格式都先由服务端返回题目交换格式 JSON v1，再在浏览器端转换为对应文件；不新增服务端接口。

### JSON

题目交换格式 JSON v1 文件，字段最全（含 `material`、`figureSvg`、`images`、`extensions` 等全部字段），适合备份题目内容或导入其他系统。

- 只导出属于当前用户的错题；不属于自己的 id 会被静默忽略。
- 可选「包含原图」：开启后，若 `originalImageUrl` 是 `data:image/png|jpeg|webp` 的 base64 内嵌图片，则放入 `images` 字段。
- 题干为空的题目会被跳过，跳过数量在响应头 `X-Export-Skipped` 中返回。
- 导出结果可直接被 `parseQuestionFile` 解析，实现往返闭环。

### Excel

.xlsx 文件（单个工作表「题目」），列与题库导入模板 `TEMPLATE_COLUMNS` 完全一致（题干、选项A~D、答案、解析、知识点、难度、题型、学科、年级学期、来源、大题、题号），可直接通过「题库导入」再导入：

- 题干末尾连续的「A．xxx」选项行会拆到 选项A~D 列；再导入时拼回题干。
- 题型写中文显示名（导入端经别名表可还原为标准 key）；知识点用「、」连接；难度写 1~5 数字。
- 图片不写入 Excel（导入端也不支持图片列）。
- 首行冻结并加粗；列宽已按内容类型调整。

### Word

.docx 文件，适合打印成试卷：

- 可自定义文档标题（默认「错题导出 yyyy-MM-dd」）。
- 按 section（无则按题型显示名，再无则不分组）分组，组标题为「第X大题 …」；题号连续。
- 可选「包含答案与解析」（默认开启）：统一放在文末「参考答案」部分，按「N. 答案：… 解析：…」格式书写，可被导入端按题号回填。
- 可选「包含原图」：图片按宽度上限等比缩放插入；webp 不写入。
- LaTeX 公式（$…$、$$…$$）以原文保留；`figureSvg` 不导出；Markdown 粗体/斜体标记原样保留。

**与完整备份的区别**：题目交换格式只包含题目内容（题干、答案、解析、知识点、难度等），不含练习记录、复习计划、试卷、用户偏好等数据。完整备份请使用「设置 → 数据管理 → 导出数据」。

## 设计原则

- **向前兼容**：解析器宽松，未知字段忽略；新增字段不升版本，破坏性变化才升版本号。
- **错误可定位**：逐题校验，单题不合格不影响其余题目，`errors` 中给出从 0 开始的题目下标与稳定的英文错误码（如 `TEXT_REQUIRED`、`TEXT_TOO_LONG`、`INVALID_DIFFICULTY`）。
- **宽松解析**：根为数组时视为 `questions` 数组；缺 `format`/`version` 时按 v1 处理并给出 warning；`version` 大于 1 时给出 warning 并尽力解析已知字段。

## 文件结构

```json
{
  "format": "wrong-notebook-questions",
  "version": 1,
  "exportedAt": "2025-11-04T10:30:00.000Z",
  "generator": "my-app",
  "questions": [ /* 见下表 */ ]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| format | string | 是 | 固定为 `wrong-notebook-questions` |
| version | number | 是 | 当前为 `1` |
| exportedAt | string | 否 | ISO 8601 导出时间 |
| generator | string | 否 | 生成器标识（应用名或版本） |
| questions | Question[] | 是 | 题目数组，最多 5000 题 |

## Question 字段

字段名与批次草稿约定一致（`answer` / `analysis` / `knowledgePoints` / `difficultyStars` / `wrongAnswer`）。除 `text` 外全部可选。

| 字段 | 类型 | 上限 | 说明 |
| --- | --- | --- | --- |
| text | string | 20000 | 题干（必填，去首尾空白后不能为空） |
| material | string | 20000 | 公共材料 |
| section | string | 500 | 大题标题（分节） |
| label | string | 20 | 原题号 |
| answer | string | 20000 | 答案 |
| analysis | string | 50000 | 解析 |
| knowledgePoints | string[] | 100 个、单点 200 | 知识点标签；解析时也接受「、，,;；」分隔的字符串 |
| difficultyStars | integer | 1~5 | 难度星级；解析时也接受数字字符串（如 `"3"`） |
| wrongAnswer | string | 20000 | 学生的错误答案 |
| subject | string | 100 | 学科名称或 key（如「数学」或 `math`） |
| gradeSemester | string | 100 | 年级学期 |
| source | string | 200 | 来源（如「2025 期中」） |
| questionType | string | 100 | 题型（字符串，先原样保留） |
| figureSvg | string | 100000 | 配图 SVG（与保存题目时的 `MAX_FIGURE_SVG_LENGTH` 一致） |
| images | { dataUrl: string, alt?: string }[] | 10 张、单张约 5MB 字符 | 内嵌图片，仅允许 `data:image/png|jpeg|webp;base64` 前缀 |
| extensions | Record<string, unknown> | — | 第三方扩展字段，解析器原样保留 |

## 错误码与警告码

### 错误码（errors）

`index` 为从 0 开始的题目下标；`index = -1` 表示**整体错误**（不是单题问题）。

| 错误码 | 说明 |
| --- | --- |
| `QUESTIONS_REQUIRED`（index=-1） | 对象形态但 `questions` 缺失或不是数组 |
| `INVALID_QUESTION_SHAPE`（index=-1） | 根输入完全无法识别（非对象非数组） |
| `INVALID_QUESTION_SHAPE`（index≥0） | 单题不是对象，或字段类型完全不符 |
| `TEXT_REQUIRED` | 题干为空（去空白后无内容） |
| `TEXT_TOO_LONG` | 题干超过 20000 字符 |
| `MATERIAL_TOO_LONG` | 材料超过 20000 字符 |
| `SECTION_TOO_LONG` | 大题标题超过 500 字符 |
| `LABEL_TOO_LONG` | 题号超过 20 字符 |
| `ANSWER_TOO_LONG` | 答案超过 20000 字符 |
| `ANALYSIS_TOO_LONG` | 解析超过 50000 字符 |
| `INVALID_DIFFICULTY` | 难度不是 1~5 的整数（含数字字符串） |
| `WRONG_ANSWER_TOO_LONG` | 错误答案超过 20000 字符 |
| `SUBJECT_TOO_LONG` | 学科超过 100 字符 |
| `GRADE_SEMESTER_TOO_LONG` | 年级学期超过 100 字符 |
| `SOURCE_TOO_LONG` | 来源超过 200 字符 |
| `QUESTION_TYPE_TOO_LONG` | 题型超过 100 字符 |
| `KNOWLEDGE_POINT_TOO_LONG` | 单个知识点超过 200 字符 |
| `TOO_MANY_KNOWLEDGE_POINTS` | 知识点超过 100 个 |
| `INVALID_IMAGE_DATA_URL` | 图片 dataUrl 不是 `data:image/png|jpeg|webp;base64` 前缀 |
| `IMAGE_TOO_LARGE` | 单张图片 dataUrl 超过约 5MB 字符（5242880） |
| `TOO_MANY_IMAGES` | 图片超过 10 张 |
| `FIGURE_SVG_TOO_LONG` | 配图 SVG 超过 100000 字符 |

### 警告码（warnings）

| 警告码 | 说明 |
| --- | --- |
| `MISSING_FORMAT` | 根对象缺少 `format` 字段 |
| `UNKNOWN_FORMAT` | `format` 存在但不是 `wrong-notebook-questions` |
| `MISSING_VERSION` | 根对象缺少 `version` 字段 |
| `UNSUPPORTED_VERSION` | `version` 大于 1（仍按已知字段尽力解析） |
| `TOO_MANY_QUESTIONS` | 题目数超过 5000，已截断 |

## 宽松规则

- 根为数组时视为 `questions`，并给出 `MISSING_FORMAT`、`MISSING_VERSION` warning。
- 缺 `format` 或 `version` 时按 v1 处理并给出对应 warning；`format` 存在但不匹配时给出 `UNKNOWN_FORMAT` warning；`version` 大于 1 时给出 `UNSUPPORTED_VERSION` warning 并尽力解析已知字段。
- 对象形态但 `questions` 缺失或不是数组时，返回 `errors=[{index:-1, reason:'QUESTIONS_REQUIRED'}]`（index=-1 表示整体错误）。
- 完全无法识别的根输入（非对象非数组）返回 `errors=[{index:-1, reason:'INVALID_QUESTION_SHAPE'}]`。
- 未知字段忽略；空字符串视为缺省（不写入结果）。
- 题目数超过 5000 时截断并给出 `TOO_MANY_QUESTIONS` warning。
- 单题不合格记入 `errors`（index 从 0 开始），其余题照常返回。

## 版本策略

- **新增字段不升版本**：解析器忽略未知字段，旧文件在新版本软件中仍可导入。
- **破坏性变化才升版本**：如删除/重命名字段、改变字段含义、收紧必填约束。升版本时同时保留旧版本的解析能力。
- 当前版本：`1`。

## 示例

最小示例（只有题干）：

```json
{
  "format": "wrong-notebook-questions",
  "version": 1,
  "questions": [
    { "text": "计算：3^2 + 4^2 = ____。" }
  ]
}
```

完整示例（全部字段）见 `doc/schemas/questions-v1.example.json`：

```json
{
  "format": "wrong-notebook-questions",
  "version": 1,
  "questions": [
    {
      "text": "阅读下面的材料，回答问题。",
      "material": "某商店购进一批商品……",
      "section": "三、解答题",
      "label": "21",
      "answer": "每件售价为 120 元。",
      "analysis": "进价 100 元，利润率 20%，售价 = 100 × (1 + 20%) = 120 元。",
      "knowledgePoints": ["一元一次方程", "利润问题"],
      "difficultyStars": 3,
      "wrongAnswer": "每件售价为 130 元。",
      "subject": "数学",
      "gradeSemester": "七年级上",
      "source": "2025 期中",
      "questionType": "解答题"
    }
  ]
}
```

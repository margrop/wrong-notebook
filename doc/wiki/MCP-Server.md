# MCP 服务

外部 agent（Claude Code、Cursor、Claude Desktop、Openclaw 等）可通过 [Model Context Protocol](https://modelcontextprotocol.io/) 的 Streamable HTTP 查询错题本、错题、知识点与今日待复习题，也可创建错题本与带配图的错题。

端点：`POST /api/mcp`。实现为无状态服务，每次请求返回 JSON 响应，不维护 `Mcp-Session-Id`；`GET` 返回 `405`（不提供独立 SSE 流）。所有工具只访问固定目标账号的数据，除查询与录入错题外，还可生成变式题、判题并记录作答结果。

## 数据流

```text
外部 agent → POST /api/mcp（Bearer 或 x-api-key）
           → MCP 工具（list_questions / add_question 等）
           → 本系统数据库（固定账号的数据）
```

## 服务端配置

```dotenv
MCP_API_KEY=替换为随机生成的集成密钥
MCP_USER_EMAIL=student@example.com
```

- `MCP_API_KEY`：调用方提交的集成密钥，可用 `openssl rand -hex 32` 生成。
- `MCP_USER_EMAIL`：固定目标账号，填邮箱（也可填用户名）；账号须存在且启用。

两项都非空时端点才开放；缺失时返回 `503`。修改环境变量后需重启或重建服务。一个端点对应一个账号，多账号需要分别部署，或用不同账号的数据目录各跑一个实例。

## 认证

请求头任选其一：

- `Authorization: Bearer <MCP_API_KEY>`（推荐）
- `x-api-key: <MCP_API_KEY>`

密钥比较使用定长比较。密钥错误或账号不存在/停用时返回 `401`。密钥会出现在请求头中，跨网络访问应使用 HTTPS，避免写入日志。

## 客户端配置

Claude Code：

```bash
claude mcp add --transport http wrong-notebook http://localhost:3000/api/mcp \
  --header "Authorization: Bearer ${MCP_API_KEY}"
```

其他支持 Streamable HTTP 的客户端（Claude Desktop、Cursor 等）按各自格式填写 URL 与请求头，例如：

```json
{
  "mcpServers": {
    "wrong-notebook": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer 替换为MCP_API_KEY" }
    }
  }
}
```

各客户端的字段名可能不同（如 `streamable-http`），以 URL 与请求头为准。

## 手工验证

初始化：

```bash
curl --fail-with-body http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer ${MCP_API_KEY}" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

列出工具：把 `method` 换成 `tools/list`。调用工具：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "add_question",
    "arguments": {
      "notebookId": "错题本ID",
      "questionText": "解方程 x+1=2",
      "answerText": "x=1",
      "analysis": "移项",
      "knowledgePoints": ["一元一次方程"],
      "gradeSemester": "七年级上",
      "difficultyStars": 2
    }
  }
}
```

`Accept` 可省略，服务会补齐；`Content-Type` 必须为 `application/json`。请求体上限 24 MiB，供含 Base64 原图的 `add_question` 使用。

## 工具

| 工具 | 作用 | 主要参数 |
| --- | --- | --- |
| `list_notebooks` | 列出错题本与题目数 | 无 |
| `create_notebook` | 创建错题本 | `name`、`stage`、`subjectKey`、`tagSet` |
| `list_questions` | 筛选、搜索与分页错题 | `notebookId`、`query`、`tag`、`chapter`、`mastery`、`timeRange`、`gradeSemester`、`paperLevel`、`questionTypes`、`page`、`pageSize` |
| `get_question` | 读取单题正文、答案、解析、标签与掌握状态 | `id`（CUID 或 6 位短 ID）、`includeImage` |
| `add_question` | 新增错题；未知知识点会按标签体系创建 | 题目文字/图片、`knowledgePoints`、`notebookId` 或 `subjectName`、`gradeSemester`、难度与题型、`figureSvg`、`figureImage`、`figureSource` 等 |
| `list_tags` | 列出知识点标签 | `subject`、`tagSet`、`query`、`flat`（默认叶子列表） |
| `list_due_reviews` | 今日待复习错题 | `notebookId`、`page`、`pageSize` |
| `get_weak_tags` | 薄弱知识点排行 | `notebookId`、`range`（`7d`/`30d`/`6m`/`all`）、`limit` |
| `record_practice_result` | 记录一次作答结果，更新掌握概率与复习排期 | `errorItemId` 或 `practiceQuestionId`、`result`（`correct`/`wrong`/`not_attempted`）、`source`（`practice`/`manual`/`review`）、`takenAt`、题目字段 |
| `generate_variant` | 为错题同步生成一道变式题并暂存为最近一次练习 | `errorItemId`、`language`、`difficulty`、`source`（`ai`/`bank`/`bankVariant`）、`bankId` |
| `get_variant` | 读取错题最近一次生成的变式题 | `errorItemId` |
| `grade_answer` | 用 AI 判定学生作答是否正确 | `practiceQuestionId` 或 `errorItemId`、`userAnswer`、`language` |

补充约定：

- 工具结果均为 JSON 文本；客户端按 JSON 解析。调用失败返回 `isError: true`。
- `add_question` 沿用「添加错题」接口的判重、年级与卷别规则；重复题返回 `duplicate` 并记录一次做错。未填 `gradeSemester` 且账号使用「AI 识别」年级规则时，会补充一次 AI 识别并计入每日用量；账号尚未同意 AI 数据授权时，需要 AI 的调用失败。
- `get_question` 默认不返回原图；`includeImage: true` 时可能返回很大的 Base64 data URL。
- `add_question` 的配图可用 `figureSvg`（AI 重绘）与 `figureImage`（裁剪原图，PNG data URI）分别传入，`figureSource` 选择界面显示来源（`svg` 默认，`image` 为原图）。`figureSvg` 支持内嵌位图，即 `<image href="data:image/png;base64,…">`（PNG/JPEG/GIF/WebP/AVIF），外部链接会被净化掉。
- `list_questions` 返回列表卡片字段（题干、标签、掌握状态等），不返回解答、动画和大图；`pageSize` 上限 1000。
- `list_tags` 默认返回叶子知识点名称，可直接用于 `add_question` 的 `knowledgePoints`。
- `generate_variant` 与 `grade_answer` 同步等待 AI 结果，不返回后台任务 id；各消耗一次 AI 额度（分别为 `practice`、`grade`）。`generate_variant` 的 `source=bank`（真题库直接选题）不消耗额度，`source=bankVariant` 先选题库题目再生成变式题、仍消耗一次 `practice` 额度。额度不足或未授权时返回 `isError: true`，文本包含错误码（如 `AI_QUOTA_INSUFFICIENT`）。
- `generate_variant` 对同一错题按 `error-item:<id>:practice` 防并发；同一时刻已有生成任务时返回 `TASK_ALREADY_RUNNING`。题库没有匹配题目时返回 `BANK_NO_MATCH`。生成成功后返回 `practiceQuestionId` 与 `saved`；`saved: false` 表示题目已生成但历史题写入失败。
- `get_variant` 只读，返回 `{ practice: LastPractice | null }`；`practice` 含题干、答案、解析、学科、难度、来源与生成时间。
- `record_practice_result` 沿用「记录练习结果」接口：`practiceQuestionId` 优先补齐题目字段并校验归属；`source=review` 且 `result=correct` 时直接把错题标记为已掌握，其他情况排入后台掌握评估。作答时间可用带时区偏移的 `takenAt`。
- `grade_answer` 优先读取 `practiceQuestionId` 的已存题目与答案，否则读取 `errorItemId` 错题的最近一次变式题；客户端传入的答案不参与对照。

实现依据：[MCP 路由](https://github.com/margrop/wrong-notebook/blob/main/src/app/api/mcp/route.ts)、[工具注册](https://github.com/margrop/wrong-notebook/blob/main/src/lib/mcp/server.ts)、[数据访问](https://github.com/margrop/wrong-notebook/blob/main/src/lib/mcp/service.ts)。

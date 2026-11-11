# MCP 服务

外部 agent（Claude Code、Cursor、Claude Desktop、Openclaw 等）可通过 [Model Context Protocol](https://modelcontextprotocol.io/) 的 Streamable HTTP 调用本系统的错题本、错题、知识点与复习数据。

端点：`POST /api/mcp`。实现为无状态服务，每次请求返回 JSON 响应，不维护 `Mcp-Session-Id`；`GET` 返回 `405`（不提供独立 SSE 流）。目标账号固定，所有工具只读写该账号的数据。

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
| `add_question` | 新增错题；未知知识点会按标签体系创建 | 题目文字/图片、`knowledgePoints`、`notebookId` 或 `subjectName`、`gradeSemester`、难度与题型等 |
| `list_tags` | 列出知识点标签 | `subject`、`tagSet`、`query`、`flat`（默认叶子列表） |
| `list_due_reviews` | 今日待复习错题 | `notebookId`、`page`、`pageSize` |
| `get_weak_tags` | 薄弱知识点排行 | `notebookId`、`range`（`7d`/`30d`/`6m`/`all`）、`limit` |

补充约定：

- 工具结果均为 JSON 文本；客户端按 JSON 解析。调用失败返回 `isError: true`。
- `add_question` 沿用「添加错题」接口的判重、年级与卷别规则；重复题返回 `duplicate` 并记录一次做错。未填 `gradeSemester` 且账号使用「AI 识别」年级规则时，会补充一次 AI 识别并计入每日用量；账号尚未同意 AI 数据授权时，需要 AI 的调用失败。
- `get_question` 默认不返回原图；`includeImage: true` 时可能返回很大的 Base64 data URL。
- `list_questions` 返回列表卡片字段（题干、标签、掌握状态等），不返回解答、动画和大图；`pageSize` 上限 1000。
- `list_tags` 默认返回叶子知识点名称，可直接用于 `add_question` 的 `knowledgePoints`。

实现依据：[MCP 路由](https://github.com/margrop/wrong-notebook/blob/main/src/app/api/mcp/route.ts)、[工具注册](https://github.com/margrop/wrong-notebook/blob/main/src/lib/mcp/server.ts)、[数据访问](https://github.com/margrop/wrong-notebook/blob/main/src/lib/mcp/service.ts)。

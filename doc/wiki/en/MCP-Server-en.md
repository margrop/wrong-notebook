# MCP Server

External agents (Claude Code, Cursor, Claude Desktop, Openclaw and others) can call this system's notebooks, questions, knowledge tags and review data through [Model Context Protocol](https://modelcontextprotocol.io/) over Streamable HTTP.

Endpoint: `POST /api/mcp`. It is stateless: every request returns a JSON response and no `Mcp-Session-Id` is kept; `GET` returns `405` because there is no standalone SSE stream. The target account is fixed, and every tool reads or writes only that account's data.

## Data flow

```text
External agent → POST /api/mcp (Bearer or x-api-key)
               → MCP tools (list_questions / add_question, etc.)
               → this system's database (fixed account data)
```

## Server configuration

```dotenv
MCP_API_KEY=replace-with-a-random-integration-key
MCP_USER_EMAIL=student@example.com
```

- `MCP_API_KEY`: the integration key callers send. Generate it with `openssl rand -hex 32`.
- `MCP_USER_EMAIL`: the fixed target account as an email (a username also works); the account must exist and be enabled.

The endpoint is only available when both are non-empty; otherwise it returns `503`. Restart or recreate the service after changing environment variables. One endpoint maps to one account; for multiple accounts, deploy one instance per account or use separate data directories.

## Authentication

Either request header works:

- `Authorization: Bearer <MCP_API_KEY>` (recommended)
- `x-api-key: <MCP_API_KEY>`

The key is compared in constant time. A wrong key or a missing/disabled account returns `401`. The key travels in request headers, so use HTTPS across networks and keep it out of logs.

## Client setup

Claude Code:

```bash
claude mcp add --transport http wrong-notebook http://localhost:3000/api/mcp \
  --header "Authorization: Bearer ${MCP_API_KEY}"
```

For other Streamable HTTP clients (Claude Desktop, Cursor and similar), fill in the URL and headers in their own format, for example:

```json
{
  "mcpServers": {
    "wrong-notebook": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer replace-with-MCP_API_KEY" }
    }
  }
}
```

Field names vary by client (for example `streamable-http`); the URL and headers are what matter.

## Manual check

Initialize:

```bash
curl --fail-with-body http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer ${MCP_API_KEY}" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Change `method` to `tools/list` to list tools. Call a tool:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "add_question",
    "arguments": {
      "notebookId": "notebook-id",
      "questionText": "Solve x+1=2",
      "answerText": "x=1",
      "analysis": "Move the constant term",
      "knowledgePoints": ["Linear equation in one variable"],
      "gradeSemester": "七年级上",
      "difficultyStars": 2
    }
  }
}
```

`Accept` may be omitted; the server fills it in. `Content-Type` must be `application/json`. The request body limit is 24 MiB, enough for `add_question` with a Base64 image.

## Tools

| Tool | Purpose | Main arguments |
| --- | --- | --- |
| `list_notebooks` | List notebooks with question counts | none |
| `create_notebook` | Create a notebook | `name`, `stage`, `subjectKey`, `tagSet` |
| `list_questions` | Filter, search and paginate questions | `notebookId`, `query`, `tag`, `chapter`, `mastery`, `timeRange`, `gradeSemester`, `paperLevel`, `questionTypes`, `page`, `pageSize` |
| `get_question` | Read one question's text, answer, analysis, tags and mastery status | `id` (CUID or 6-character short ID), `includeImage` |
| `add_question` | Add a question; unknown knowledge points are created in the tag set | question text/image, `knowledgePoints`, `notebookId` or `subjectName`, `gradeSemester`, difficulty and type |
| `list_tags` | List knowledge tags | `subject`, `tagSet`, `query`, `flat` (leaf list by default) |
| `list_due_reviews` | Questions due for review today | `notebookId`, `page`, `pageSize` |
| `get_weak_tags` | Rank weak knowledge points | `notebookId`, `range` (`7d`/`30d`/`6m`/`all`), `limit` |

Notes:

- Tool results are JSON text; clients parse the JSON. Failures return `isError: true`.
- `add_question` follows the same duplicate detection, grade and paper-group rules as the Add Question API. A duplicate returns `duplicate` and records another wrong attempt. When `gradeSemester` is omitted and the account uses AI grade recognition, one extra AI call counts against the daily quota; if the account has not accepted AI data consent, AI-dependent calls fail.
- `get_question` omits the original image by default; `includeImage: true` may return a large Base64 data URL.
- `list_questions` returns compact card fields (question text, tags, mastery status) without answers, animations or large images; `pageSize` is capped at 1000.
- `list_tags` returns leaf knowledge-point names by default, ready for `add_question` `knowledgePoints`.

Implementation: [MCP route](https://github.com/margrop/wrong-notebook/blob/main/src/app/api/mcp/route.ts), [tool registration](https://github.com/margrop/wrong-notebook/blob/main/src/lib/mcp/server.ts), [data access](https://github.com/margrop/wrong-notebook/blob/main/src/lib/mcp/service.ts).

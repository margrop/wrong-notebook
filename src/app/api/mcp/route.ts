import { createLogger } from "@/lib/logger";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { createMcpServer } from "@/lib/mcp/server";

const logger = createLogger("api:mcp");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** MCP 请求体上限：容纳含 base64 原图的 add_question 调用 */
const MAX_REQUEST_BODY_SIZE = 24 * 1024 * 1024;

/** JSON-RPC 错误响应（HTTP 层鉴权或配置错误） */
function mcpHttpError(status: number, code: number, message: string): Response {
    return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code, message },
    }), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    });
}

/**
 * 部分 MCP 客户端只发送 application/json；SDK 的 Streamable HTTP 校验要求
 * Accept 同时列出 application/json 与 text/event-stream，这里补齐缺失值。
 */
function normalizeMcpAccept(req: Request): Request {
    const accept = req.headers.get("accept");
    if (accept?.includes("application/json") && accept.includes("text/event-stream")) {
        return req;
    }
    const headers = new Headers(req.headers);
    headers.set("Accept", "application/json, text/event-stream");
    return new Request(req, { headers });
}

/**
 * MCP Streamable HTTP 端点（无状态）。
 * 认证：Authorization: Bearer <MCP_API_KEY> 或 x-api-key；目标账号由 MCP_USER_EMAIL 固定。
 * 每个请求创建独立传输与服务实例，不依赖 Mcp-Session-Id；POST 返回 JSON 响应。
 */
export async function POST(req: Request) {
    const auth = await authenticateMcpRequest(req);
    if (!auth.ok) {
        return mcpHttpError(auth.status, -32001, auth.message);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: MAX_REQUEST_BODY_SIZE,
    });
    const server = createMcpServer(auth.user);

    try {
        await server.connect(transport);
        return await transport.handleRequest(normalizeMcpAccept(req));
    } catch (error) {
        logger.error({ error }, "MCP request failed");
        return mcpHttpError(500, -32603, "MCP request failed");
    } finally {
        await server.close();
    }
}

/** 无状态端点不提供 GET SSE 流；客户端应使用 POST */
export async function GET() {
    const response = mcpHttpError(405, -32000, "MCP Streamable HTTP: use POST; this server has no standalone SSE stream");
    response.headers.set("Allow", "POST");
    return response;
}

/** 无状态端点没有可终止的会话 */
export async function DELETE() {
    const response = mcpHttpError(405, -32000, "MCP Streamable HTTP: no session to delete");
    response.headers.set("Allow", "POST");
    return response;
}

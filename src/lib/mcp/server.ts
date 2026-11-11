import "server-only";

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getAppVersion } from "@/lib/app-version";
import type { User } from "@prisma/client";
import {
    NOTEBOOK_STAGES,
    NOTEBOOK_SUBJECTS,
} from "@/lib/notebook-scope";
import { MASTERY_STATUSES } from "@/lib/mastery-status";
import { QUESTION_TYPES } from "@/lib/question/question-type";
import {
    addQuestion,
    createNotebook,
    getQuestion,
    getWeakTags,
    listDueReviews,
    listNotebooks,
    listQuestions,
    listTags,
} from "@/lib/mcp/service";

/** 把工具结果序列化为 MCP 文本内容；客户端按 JSON 解析 */
function jsonResult(value: unknown): CallToolResult {
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function toolError(message: string): CallToolResult {
    return { content: [{ type: "text", text: message }], isError: true };
}

const QUESTION_TYPE_FILTERS = [...QUESTION_TYPES, "none"] as const;

/**
 * 为固定账号创建 MCP 服务器并注册全部工具。
 * 每次 HTTP 请求创建独立实例（无状态 Streamable HTTP），不跨请求保存会话状态。
 */
export function createMcpServer(user: User): McpServer {
    const server = new McpServer({
        name: "wrong-notebook",
        version: getAppVersion(),
    });

    server.registerTool(
        "list_notebooks",
        {
            title: "List notebooks",
            description: "List the user's wrong-notebooks (错题本) with stage, subject and question count. Returns JSON.",
            annotations: { readOnlyHint: true },
        },
        async () => jsonResult({ notebooks: await listNotebooks(user.id) }),
    );

    server.registerTool(
        "create_notebook",
        {
            title: "Create notebook",
            description: "Create a wrong-notebook for a school stage and subject. stage: primary/junior_high/senior_high/university. Primary allows math/english/chinese/science; other stages allow math/english/chinese/science/physics/chemistry/biology/history/geography/politics. Returns JSON.",
            inputSchema: {
                name: z.string().trim().min(1).describe("Notebook display name, unique per user"),
                stage: z.enum(NOTEBOOK_STAGES),
                subjectKey: z.enum(NOTEBOOK_SUBJECTS),
                tagSet: z.string().optional().describe("Knowledge tag set, defaults to 'default'"),
            },
        },
        async (args) => jsonResult({
            notebook: await createNotebook(user, args),
        }),
    );

    server.registerTool(
        "list_questions",
        {
            title: "List / search questions",
            description: "List error questions with filters and pagination. Use notebookId, query text, tag name, mastery status, time range, grade semester, paper level or question types. Returns compact cards as JSON with masteryStatus.",
            inputSchema: {
                notebookId: z.string().optional().describe("Notebook (subject) id"),
                query: z.string().optional().describe("Text search in question, analysis, wrong answer and knowledge points; a 6-character short id also matches"),
                tag: z.string().optional().describe("Exact knowledge tag name"),
                chapter: z.string().optional().describe("Chapter tag name; includes its descendant tags"),
                mastery: z.enum(MASTERY_STATUSES).optional(),
                timeRange: z.enum(["all", "week", "month"]).optional(),
                gradeSemester: z.string().optional().describe("Grade/semester filter, e.g. 七年级上"),
                paperLevel: z.string().optional().describe("Paper group id"),
                questionTypes: z.array(z.enum(QUESTION_TYPE_FILTERS)).optional().describe("Question types; 'none' matches unset types"),
                page: z.number().int().min(1).optional(),
                pageSize: z.number().int().min(1).max(1000).optional(),
            },
            annotations: { readOnlyHint: true },
        },
        async (args) => jsonResult(await listQuestions(user, args)),
    );

    server.registerTool(
        "get_question",
        {
            title: "Get question",
            description: "Get one question by CUID id or 6-character shortId, including question text, answer, analysis, mistake notes, tags, notebook and mastery status. Set includeImage=true to also return the original image data URL or URL. Returns JSON.",
            inputSchema: {
                id: z.string().min(1).describe("Question CUID or shortId"),
                includeImage: z.boolean().optional().describe("Include originalImageUrl (may be large base64)"),
            },
            annotations: { readOnlyHint: true },
        },
        async (args) => jsonResult({
            question: await getQuestion(user.id, user.masteryThreshold, args),
        }),
    );

    server.registerTool(
        "add_question",
        {
            title: "Add question",
            description: "Add an error question to a notebook. Provide questionText and/or originalImageUrl. knowledgePoints are tag names; unknown names are created under the notebook's tag set. Duplicate detection applies. If gradeSemester is omitted and the account uses AI grade recognition, one AI call counts against quota. Returns JSON with created or duplicate status.",
            inputSchema: {
                notebookId: z.string().optional().describe("Target notebook id; omit to use subjectName"),
                subjectName: z.string().optional().describe("Notebook name; creates it if missing when notebookId is omitted"),
                questionText: z.string().optional(),
                answerText: z.string().optional(),
                analysis: z.string().optional(),
                wrongAnswerText: z.string().optional(),
                mistakeAnalysis: z.string().optional(),
                mistakeStatus: z.enum(["not_attempted", "wrong_attempt", "unknown"]).optional(),
                knowledgePoints: z.array(z.string().trim().min(1)).max(100).optional(),
                gradeSemester: z.string().optional().describe("e.g. 七年级上; overrides the account grade rule"),
                recognizedGradeSemester: z.string().optional(),
                paperLevel: z.string().optional().describe("Paper group id"),
                difficultyStars: z.number().int().min(1).max(5).optional(),
                questionType: z.string().optional().describe("single_choice, multiple_choice, true_false, fill_blank, calculation, solution, reading, cloze, writing or other"),
                source: z.string().optional(),
                originalImageUrl: z.string().optional().describe("Image URL or data URL"),
                geogebraCommands: z.string().optional(),
                hasFigure: z.boolean().optional(),
                figureSvg: z.string().optional(),
            },
        },
        async (args) => {
            const result = await addQuestion(user, args);
            if (!result.ok) {
                return toolError(JSON.stringify(result.error));
            }
            const { item, status } = result;
            return jsonResult({
                status,
                question: {
                    id: item.id,
                    shortId: item.shortId,
                    questionText: item.questionText,
                    subject: item.subject,
                    tags: item.tags.map((tag) => ({ id: tag.id, name: tag.name })),
                    ...(status === "duplicate" ? {
                        duplicate: true,
                        similarity: item.similarity,
                        mistakeRecorded: item.mistakeRecorded,
                    } : {}),
                },
            });
        },
    );

    server.registerTool(
        "list_tags",
        {
            title: "List knowledge tags",
            description: "List knowledge-point tags for a subject and tag set. flat=true (default) returns leaf tag names usable as add_question knowledgePoints; flat=false returns the tag tree. Use query to filter by name. Returns JSON.",
            inputSchema: {
                subject: z.string().min(1).describe("Subject key, e.g. math"),
                tagSet: z.string().optional().describe("Tag set, defaults to 'default'"),
                query: z.string().optional().describe("Filter by tag name substring"),
                flat: z.boolean().optional().describe("Leaf list (true, default) or tree (false)"),
            },
            annotations: { readOnlyHint: true },
        },
        async (args) => jsonResult(await listTags(user.id, args)),
    );

    server.registerTool(
        "list_due_reviews",
        {
            title: "List due reviews",
            description: "List questions due for review today, based on answer history and the spaced-review schedule. Optionally filter by notebookId. Returns JSON with reviewStage and nextReviewAt.",
            inputSchema: {
                notebookId: z.string().optional(),
                page: z.number().int().min(1).optional(),
                pageSize: z.number().int().min(1).max(1000).optional(),
            },
            annotations: { readOnlyHint: true },
        },
        async (args) => jsonResult(await listDueReviews(user.id, args)),
    );

    server.registerTool(
        "get_weak_tags",
        {
            title: "Get weak knowledge points",
            description: "Rank weak knowledge points by unmastered question count and recent error rate. range: 7d/30d/6m/all over question creation time; optional notebookId and limit (default 10). Returns JSON.",
            inputSchema: {
                notebookId: z.string().optional(),
                range: z.enum(["7d", "30d", "6m", "all"]).optional().describe("Defaults to 30d"),
                limit: z.number().int().min(1).max(50).optional(),
            },
            annotations: { readOnlyHint: true },
        },
        async (args) => jsonResult(await getWeakTags(user.id, args)),
    );

    return server;
}

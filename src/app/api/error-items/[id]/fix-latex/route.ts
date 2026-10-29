import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAIService } from "@/lib/ai";
import type { LatexFixInput } from "@/lib/ai";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { countLatexIssues, findLatexIssuesByField, isAcceptableLatexFix, LATEX_FIELDS } from "@/lib/latex-check";
import type { LatexField } from "@/lib/latex-check";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:error-items:fix-latex');

/**
 * POST /api/error-items/:id/fix-latex
 * 用 KaTeX 检查题目、答案、解析、错误解答和错因分析中的 LaTeX，只把有问题的字段交给 AI 修复；
 * 修复后问题减少且内容长度变化不大时才保存，否则保留原文。
 */
async function handlePost(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const item = await prisma.errorItem.findUnique({
            where: { id },
            select: { userId: true, shortId: true, questionText: true, answerText: true, analysis: true, wrongAnswerText: true, mistakeAnalysis: true },
        });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }

        const issuesBefore = findLatexIssuesByField(item);
        const totalBefore = countLatexIssues(issuesBefore);
        if (totalBefore === 0) {
            return NextResponse.json({ issuesBefore: 0, issuesAfter: 0, fixedFields: [], updated: {} });
        }

        const input: LatexFixInput = {};
        for (const field of Object.keys(issuesBefore) as LatexField[]) {
            input[field] = {
                text: item[field] || "",
                issues: issuesBefore[field]!.map((issue) => `${issue.snippet}：${issue.message}`),
            };
        }

        const limited = await consumeAiQuota(user, 'latex');
        if (limited) return limited;

        const fixed = await trackBackgroundTask(
            { userId: user.id, kind: 'fix_latex', subject: describeQuestion(item), link: `/error-items/${id}` },
            () => getAIService().fixLatex(input)
        );
        const updated: Partial<Record<LatexField, string>> = {};
        for (const field of Object.keys(input) as LatexField[]) {
            const candidate = fixed[field];
            if (candidate && isAcceptableLatexFix(input[field]!.text, candidate)) {
                updated[field] = candidate;
            }
        }

        if (Object.keys(updated).length > 0) {
            await prisma.errorItem.update({ where: { id }, data: updated });
        }

        const issuesAfter = countLatexIssues(findLatexIssuesByField(
            Object.fromEntries(LATEX_FIELDS.map((field) => [field, updated[field] ?? item[field]]))
        ));
        logger.info({ errorItemId: id, issuesBefore: totalBefore, issuesAfter, fixedFields: Object.keys(updated) }, 'LaTeX fixed');
        return NextResponse.json({ issuesBefore: totalBefore, issuesAfter, fixedFields: Object.keys(updated), updated });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, 'Error fixing LaTeX');
        // AI 错误码交给前端映射为提示文案
        return internalError(message.startsWith('AI_') ? message.split(':')[0] : "Failed to fix LaTeX");
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);

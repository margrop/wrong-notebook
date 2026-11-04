/**
 * 保存题目领域结果到 HTTP 响应的适配层。
 * 状态码与响应体字段与重构前的「添加错题」接口保持一致：新题 201、重复题 200、失败时统一错误响应，
 * 错误响应只包含可公开的错误分类，不含原始 SQL、路径、凭据或服务商原文。
 */
import { NextResponse } from "next/server";
import { createErrorResponse } from "@/lib/api-errors";
import type { SaveQuestionResult } from "@/lib/question/question-save";
import { classifyQuestionSaveError } from "@/lib/question/question-save-failure";
import type { QuestionSaveFailure, QuestionSaveFailureStage } from "@/lib/question/question-save-failure";

/** 把失败结果转换为统一错误响应 */
export function questionSaveFailureToResponse(failure: QuestionSaveFailure) {
    return createErrorResponse(failure.code, failure.status, failure.errorCode, failure.details);
}

/** 把保存过程中的异常分类后转换为统一错误响应 */
export function questionSaveErrorResponse(error: unknown, stage: QuestionSaveFailureStage = 'save') {
    return questionSaveFailureToResponse(classifyQuestionSaveError(error, stage));
}

export function saveQuestionResultToResponse(result: SaveQuestionResult): NextResponse {
    if (!result.ok) return questionSaveFailureToResponse(result.error);
    return NextResponse.json(result.item, { status: result.status === 'duplicate' ? 200 : 201 });
}

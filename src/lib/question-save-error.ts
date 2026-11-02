import { getApiErrorMessage, getErrorMessage } from '@/lib/error-message';
import type { Translations } from '@/lib/translations';

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function translatedError(key: unknown, t: Translations): string | undefined {
    if (typeof key !== 'string' || !/^(QUESTION_SAVE_|AI_)[A-Z_]+$/.test(key)) return undefined;
    const message = (t.errors as Record<string, unknown>)[key];
    return typeof message === 'string' ? message : undefined;
}

/** 只展示校验规则及已知字段名称，不回显输入值或后端原始校验消息。 */
function validationMessages(details: unknown, t: Translations): string[] {
    if (!Array.isArray(details)) return [];
    const fields: Record<string, string> = {
        questionText: t.editor.question, answerText: t.editor.answer, analysis: t.editor.analysis,
        wrongAnswerText: t.editor.wrongAnswerText, mistakeAnalysis: t.editor.mistakeAnalysis,
        knowledgePoints: t.editor.tags, subjectId: t.editor.selectNotebook,
        gradeSemester: t.editor.gradeSemester, paperLevel: t.editor.paperLevel,
    };
    return details.slice(0, 3).flatMap((value: unknown) => {
        const issue = asRecord(value);
        const path = issue?.path;
        const field = Array.isArray(path) && typeof path[0] === 'string' ? fields[path[0]] : undefined;
        if (!field) return [];
        const maximum = issue?.maximum;
        let template = t.questionSave.invalidField;
        if (issue?.code === 'too_big' && typeof maximum === 'number' && Number.isSafeInteger(maximum) && maximum >= 0) {
            template = issue.origin === 'array' ? t.questionSave.tooMany : t.questionSave.tooLong;
        }
        return [template.replace('{field}', field).replace('{maximum}', String(maximum))];
    });
}

/** 保存错误同时用于轻提示和表单内的持久提示；未知响应只展示状态码。 */
export function getQuestionSaveErrorMessage(error: unknown, t: Translations): string {
    const record = asRecord(error);
    const data = asRecord(record?.data);
    const status = typeof record?.status === 'number' ? record.status : undefined;
    const backendMessage = getApiErrorMessage(error);
    const translated = translatedError(backendMessage, t) ?? translatedError(data?.code, t);
    const statusMessages: Record<number, string> = {
        400: t.errors.QUESTION_SAVE_INVALID_INPUT, 401: t.errors.QUESTION_SAVE_UNAUTHORIZED,
        403: t.errors.QUESTION_SAVE_FORBIDDEN, 408: t.errors.QUESTION_SAVE_TIMEOUT,
        409: t.errors.QUESTION_SAVE_CONFLICT, 413: t.errors.QUESTION_SAVE_TOO_LARGE,
        429: t.errors.QUESTION_SAVE_RATE_LIMITED,
        502: t.errors.QUESTION_SAVE_SERVER_UNAVAILABLE, 503: t.errors.QUESTION_SAVE_SERVER_UNAVAILABLE,
        504: t.errors.QUESTION_SAVE_TIMEOUT,
    };
    let message = translated ?? (status ? statusMessages[status] : undefined) ?? t.errors.QUESTION_SAVE_FAILED;
    if (!status && (error instanceof TypeError || /fetch|network|load failed/i.test(getErrorMessage(error)))) {
        message = t.errors.QUESTION_SAVE_NETWORK_ERROR;
    }
    const details = asRecord(data?.details);
    if (backendMessage === 'QUESTION_SAVE_GRADE_FAILED') {
        const reason = translatedError(details?.reason, t);
        if (reason) message += `\n${reason}`;
    }
    if (status === 400) message += validationMessages(data?.details, t).map((line) => `\n${line}`).join('');
    if (typeof details?.databaseCode === 'string' && /^P\d{4}$/.test(details.databaseCode)) {
        message += `\n${t.questionSave.databaseCode.replace('{code}', details.databaseCode)}`;
    }
    if (status) message += ` (HTTP ${status})`;
    return message;
}

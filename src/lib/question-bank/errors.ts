/**
 * 真题库导入接口错误码的识别（前后端共用，不依赖 React）。
 * 接口把错误码写在 message 开头，如 "BANK_NAME_EXISTS: 数学题库（小学）"；
 * 组件据此改用本地化文案，避免直接把错误码显示给用户。
 */
export const BANK_ERROR_CODES = [
    "BANK_NAME_EXISTS",
    "BANK_INVALID_FORMAT",
    "BANK_FILE_TOO_LARGE",
    "BANK_INVALID_INPUT",
    "BANK_EMPTY",
    "BANK_INVALID_NOTEBOOK",
] as const;

export type BankErrorCode = (typeof BANK_ERROR_CODES)[number];

/** 从接口返回的 message 取出题库导入错误码；不是已知错误码时返回 null */
export function bankErrorCodeFromMessage(message: string | undefined): BankErrorCode | null {
    const prefix = message?.split(":")[0]?.trim();
    return prefix && (BANK_ERROR_CODES as readonly string[]).includes(prefix) ? prefix as BankErrorCode : null;
}

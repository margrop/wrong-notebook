/** base58 字母表（去掉易混淆的 0、O、I、l） */
export const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const SHORT_ID_LENGTH = 6;

const SHORT_ID_PATTERN = new RegExp(`^[${BASE58_ALPHABET}]{${SHORT_ID_LENGTH}}$`);

/** 判断是否为合法短 ID（前后端通用，不依赖 Node API） */
export function isShortId(value: string | null | undefined): value is string {
    return typeof value === "string" && SHORT_ID_PATTERN.test(value);
}

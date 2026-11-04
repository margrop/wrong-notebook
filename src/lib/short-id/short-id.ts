import "server-only";

import { randomBytes } from "crypto";
import { BASE58_ALPHABET, SHORT_ID_LENGTH } from "@/lib/short-id/short-id-format";

export { BASE58_ALPHABET, SHORT_ID_LENGTH, isShortId } from "@/lib/short-id/short-id-format";

const MAX_ATTEMPTS = 10;

/** 生成 6 位 base58 随机 ID（拒绝采样保证均匀分布） */
export function generateShortId(): string {
    let id = "";
    while (id.length < SHORT_ID_LENGTH) {
        for (const byte of randomBytes(SHORT_ID_LENGTH * 2)) {
            // 58 * 4 = 232，丢弃 >= 232 的字节以避免取模偏差
            if (byte < 232 && id.length < SHORT_ID_LENGTH) {
                id += BASE58_ALPHABET[byte % 58];
            }
        }
    }
    return id;
}

interface ShortIdLookup {
    errorItem: {
        findUnique(args: { where: { shortId: string }; select: { id: true } }): Promise<{ id: string } | null>;
    };
}

/** 生成一个数据库中尚未使用的短 ID；可传入事务客户端 */
export async function generateUniqueShortId(client: ShortIdLookup): Promise<string> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const shortId = generateShortId();
        const existing = await client.errorItem.findUnique({ where: { shortId }, select: { id: true } });
        if (!existing) {
            return shortId;
        }
    }
    throw new Error("Failed to generate a unique short ID");
}

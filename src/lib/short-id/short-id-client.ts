import { apiClient } from "@/lib/api-client";

/** 按短 ID 查找当前用户的题目，返回题目 ID；找不到时返回 null */
export async function locateByShortId(shortId: string): Promise<string | null> {
    try {
        const result = await apiClient.get<{ id: string }>(`/api/error-items/short/${encodeURIComponent(shortId)}`);
        return result.id;
    } catch {
        return null;
    }
}

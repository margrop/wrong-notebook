/**
 * 修正题目文字（删去草稿、修正 OCR 错字）的输入输出与回复解析，四个提供商共用。
 * 模型输出不可信：只接受输入中出现过的 id，每个 id 取第一项；文字的安全校验由调用方按原文进行。
 */
import { z } from 'zod';
import { stripThinkingTags } from './schema';

export type TextFixInput = Array<{ id: string; text: string }>;
export type TextFixResult = Array<{ id: string; text: string; uncertain: string[] }>;

const rawItem = z.object({
    id: z.union([z.string(), z.number()]),
    text: z.string(),
    uncertain: z.array(z.unknown()).nullish(),
}).passthrough();
const rawResult = z.object({ questions: z.array(z.unknown()) });

function readJson(text: string): z.infer<typeof rawResult> {
    let body = stripThinkingTags(text);
    const block = body.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (block) body = block[1];
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start !== -1 && end > start) {
        try {
            const parsed = rawResult.safeParse(JSON.parse(body.slice(start, end + 1)));
            if (parsed.success) return parsed.data;
        } catch {
            // 落到下面统一报错
        }
    }
    throw new Error('AI_RESPONSE_ERROR: invalid text fix output');
}

/** 解析模型回复；没有返回的题不出现在结果中（由调用方视为修正失败） */
export function parseTextFix(text: string, input: TextFixInput): TextFixResult {
    const ids = new Set(input.map((item) => item.id));
    const seen = new Set<string>();
    const result: TextFixResult = [];
    for (const entry of readJson(text).questions) {
        const parsed = rawItem.safeParse(entry);
        if (!parsed.success) continue;
        const id = String(parsed.data.id);
        if (!ids.has(id) || seen.has(id)) continue;
        seen.add(id);
        const uncertain = (parsed.data.uncertain ?? [])
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim().slice(0, 200))
            .slice(0, 20);
        result.push({ id, text: parsed.data.text.trim(), uncertain });
    }
    return result;
}

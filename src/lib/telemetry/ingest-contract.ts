import { z } from "zod";

export const TELEMETRY_SCHEMA_VERSION = 1;
export const MAX_BATCH_BYTES = 64 * 1024;
export const MAX_BATCH_ITEMS = 100;
export const NAME_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;
export const TOKEN_PATTERN = /^[A-Za-z0-9_.<>+-]{1,32}$/;
export const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,47}$/;
const reservedKeys = new Set(["__proto__", "prototype", "constructor"]);

const nameSchema = z.string().regex(NAME_PATTERN);
// 设计样例使用 aiConfigured，维度键兼容驼峰；事件名仍只接受小写。
const payloadSchema = z.record(z.string().regex(/^[a-z][A-Za-z0-9_]{1,47}$/), z.union([z.boolean(), z.string().regex(TOKEN_PATTERN)]))
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 8 || Object.keys(value).some(key => reservedKeys.has(key))) {
      ctx.addIssue({ code: "custom", message: "维度最多八个且不得使用保留键" });
    }
  });

export function utcDay(date: Date): string { return date.toISOString().slice(0, 10); }
export function shiftDay(day: string, amount: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + amount * 86_400_000));
}

function daySchema(now: Date) {
  const today = utcDay(now);
  return z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(day => {
    const date = new Date(`${day}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && utcDay(date) === day
      && day >= shiftDay(today, -7) && day <= shiftDay(today, 1);
  }, "日期须为 UTC 今天前七天至后一天的有效日期");
}

export const envelopeSchema = z.strictObject({
  schema: z.number().int().nonnegative().max(1000),
  app: z.literal("wrong-notebook"),
  version: z.string().regex(VERSION_PATTERN),
  items: z.array(z.unknown()).min(1).max(MAX_BATCH_ITEMS),
});

export function itemSchema(now: Date) {
  return z.discriminatedUnion("t", [
    z.strictObject({
      t: z.literal("event"), day: daySchema(now), name: nameSchema,
      payload: payloadSchema.optional(),
    }),
    z.strictObject({
      t: z.literal("error"), day: daySchema(now),
      kind: z.enum(["client", "boundary", "server"]),
      // scope 的命名空间分隔符允许冒号，以兼容 api:ai 等已定协议样例。
      scope: z.string().regex(/^[A-Za-z0-9_.:\[\]-]{1,64}$/),
      name: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
      fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    }),
  ]);
}

export type IngestEnvelope = z.infer<typeof envelopeSchema>;
export type IngestItem = z.infer<ReturnType<typeof itemSchema>>;
export type EventItem = Extract<IngestItem, { t: "event" }>;
export type ErrorItem = Extract<IngestItem, { t: "error" }>;

export function validateItems(items: unknown[], now: Date) {
  const validator = itemSchema(now);
  const accepted: IngestItem[] = [];
  for (const item of items) {
    const result = validator.safeParse(item);
    if (result.success) accepted.push(result.data);
  }
  return { accepted, rejected: items.length - accepted.length };
}

export function canonicalPayload(payload?: EventItem["payload"]): string {
  return JSON.stringify(Object.fromEntries(Object.entries(payload ?? {}).sort(([left], [right]) => left.localeCompare(right, "en"))));
}

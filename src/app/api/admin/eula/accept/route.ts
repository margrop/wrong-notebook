import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest } from "@/lib/api-errors";
import { withAdmin } from "@/lib/api-handler";
import { EULA_VERSION } from "@/lib/eula";
import { acceptEula, getEulaStatus, isEulaPending } from "@/lib/eula/server";

const acceptSchema = z.strictObject({ version: z.string() });

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/eula/accept：管理员同意当前版本的使用协议（实例级）。
 * version 必须等于当前版本，防止旧页面误同意新协议；协议待重新同意时同样可用
 */
export const POST = withAdmin(async (req: Request) => {
    const parsed = acceptSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success || parsed.data.version !== EULA_VERSION) return badRequest("EULA_VERSION_MISMATCH");
    const trigger = isEulaPending() ? "upgrade" : "settings";
    await acceptEula({ acceptedBy: "admin-dialog", trigger });
    return NextResponse.json(getEulaStatus(true));
}, { allowEulaPending: true });

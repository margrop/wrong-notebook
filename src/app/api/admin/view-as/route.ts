import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdmin } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { validationError } from "@/lib/api-errors";
import { prisma } from "@/lib/prisma";
import { ADMIN_VIEW_AS_COOKIE, ADMIN_VIEW_AS_MAX_AGE } from "@/lib/admin-view-as";

const bodySchema = z.object({ userId: z.string().min(1) });

/** GET：返回当前管理员正在查看的目标用户，未启用时 target 为 null */
export const GET = withAdmin(async (_req: Request, { session }: AuthenticatedContext) => {
    const store = await cookies();
    const targetId = store.get(ADMIN_VIEW_AS_COOKIE)?.value;
    if (!targetId) return NextResponse.json({ target: null });

    const target = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, name: true, email: true },
    });
    // 管理员本人不进入「查看他人」模式
    if (!target || target.id === session.user.id) return NextResponse.json({ target: null });
    return NextResponse.json({ target });
});

/** POST：设置查看目标；之后该管理员的普通 API 请求都按目标用户执行 */
export const POST = withAdmin(async (req: Request) => {
    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
        return validationError("Invalid view-as target", parsed.error.issues);
    }

    const target = await prisma.user.findUnique({
        where: { id: parsed.data.userId },
        select: { id: true, name: true, email: true, role: true },
    });
    if (!target) return validationError("User not found", [{ code: "not_found", path: ["userId"], message: "User not found" }]);

    const store = await cookies();
    store.set(ADMIN_VIEW_AS_COOKIE, target.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: ADMIN_VIEW_AS_MAX_AGE,
    });
    return NextResponse.json({ target: { id: target.id, name: target.name, email: target.email } });
});

/** DELETE：退出查看模式，恢复管理员本人视角 */
export const DELETE = withAdmin(async () => {
    const store = await cookies();
    store.delete(ADMIN_VIEW_AS_COOKIE);
    return NextResponse.json({ target: null });
});

import "server-only";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** 根据会话邮箱获取当前登录用户；未登录或用户不存在时返回 null */
export async function getCurrentUser() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return null;
    }
    return prisma.user.findUnique({ where: { email: session.user.email } });
}

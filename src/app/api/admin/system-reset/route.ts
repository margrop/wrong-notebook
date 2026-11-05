import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { internalError } from "@/lib/api-errors";
import { notifyAiAccountUsersDeleted } from "@/lib/ai/account-provider";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:admin:system-reset');

async function handlePost(_req: Request, { session }: AuthenticatedContext) {
    // 更安全的「恢复出厂」逻辑：
    // 1. 删除全部练习记录
    // 2. 删除全部错题
    // 3. 删除全部错题本
    // 4. 删除全部自定义知识点（保留系统标签）
    // 不删除当前用户，保留其登录能力

    try {
        logger.info({ email: session.user.email }, 'System reset initiated');

        const deletedUserIds: string[] = [];
        await prisma.$transaction(async (tx) => {
            await tx.practiceRecord.deleteMany({});
            await tx.errorItem.deleteMany({});
            await tx.subject.deleteMany({});
            await tx.knowledgeTag.deleteMany({
                where: {
                    isSystem: false,
                }
            });

            // 删除除当前用户外的其他用户
            if (session.user?.email) {
                const others = { email: { not: session.user.email } };
                const users = await tx.user.findMany({ where: others, select: { id: true } });
                await tx.user.deleteMany({ where: others });
                deletedUserIds.push(...users.map((user) => user.id));
            }
        });
        await notifyAiAccountUsersDeleted(deletedUserIds);

        logger.info('System reset completed successfully');
        return NextResponse.json({ success: true, message: "System reset complete" });
    } catch (error) {
        logger.error({ error }, 'System reset error');
        return internalError("Failed to reset system");
    }
}

export const POST = withAdmin(handlePost);

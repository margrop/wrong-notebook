import { NextResponse } from "next/server"
import { withAdmin } from "@/lib/api-handler"
import type { AuthenticatedContext } from "@/lib/api-handler"
import { prisma } from "@/lib/prisma"
import { badRequest, internalError } from "@/lib/api-errors"
import { notifyAiAccountUsersDeleted } from "@/lib/ai/account-provider"
import { createLogger } from "@/lib/logger"
import { adminUserUpdateSchema } from "@/lib/schemas/admin"

const logger = createLogger('api:admin:users:id');

type RouteContext = { params: Promise<{ id: string }> };

async function handlePatch(req: Request, { session, params }: RouteContext & AuthenticatedContext) {
    const { id } = await params;

    try {
        const parsed = adminUserUpdateSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return badRequest("Invalid request body");
        const { isActive } = parsed.data;

        // Prevent disabling self
        if (id === session?.user.id) {
            return badRequest("Cannot disable your own account")
        }

        // Prevent disabling super admin
        const targetUser = await prisma.user.findUnique({
            where: { id }
        })

        if (targetUser?.email === 'admin@localhost') {
            return badRequest("Cannot disable super admin")
        }

        const user = await prisma.user.update({
            where: {
                id
            },
            data: {
                isActive
            }
        })

        return NextResponse.json(user)
    } catch (error) {
        logger.error({ error }, 'Error updating user');
        return internalError("Failed to update user")
    }
}

async function handleDelete(_req: Request, { session, params }: RouteContext & AuthenticatedContext) {
    const { id } = await params;

    try {
        // Prevent deleting self
        if (id === session?.user.id) {
            return badRequest("Cannot delete your own account")
        }

        // Prevent deleting super admin
        const targetUser = await prisma.user.findUnique({
            where: { id }
        })

        if (targetUser?.role === 'admin') {
            if (targetUser.email === 'admin@localhost') {
                return badRequest("Cannot delete super admin")
            }
        }

        const user = await prisma.user.delete({
            where: {
                id
            }
        })
        await notifyAiAccountUsersDeleted([user.id])

        return NextResponse.json(user)
    } catch (error) {
        logger.error({ error }, 'Error deleting user');
        return internalError("Failed to delete user")
    }
}

export const PATCH = withAdmin(handlePatch);
export const DELETE = withAdmin(handleDelete);

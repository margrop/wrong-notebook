import "server-only";

import { Session } from "next-auth"

export function isAdmin(user: { role?: string } | null | undefined) {
    return user?.role === "admin"
}

export function requireAdmin(session: Session | null) {
    if (!session || !isAdmin(session.user)) {
        return false
    }
    return true
}

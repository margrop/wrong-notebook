import { z } from "zod";

/** PATCH /api/admin/users/[id] 的请求体：启用或禁用用户 */
export const adminUserUpdateSchema = z.object({
    isActive: z.boolean(),
});

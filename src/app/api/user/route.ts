import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { z } from "zod";
import { compare, hash } from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { unauthorized, notFound, badRequest, forbidden, validationError, internalError } from "@/lib/api-errors";
import { notifyAiAccountUsersDeleted } from "@/lib/ai/account-provider";
import { createLogger } from "@/lib/logger";
import { isDefaultAdminPassword } from "@/lib/default-admin";
import { syncMasteryLevels } from "@/lib/mastery";
import { MAX_MASTERY_THRESHOLD, MIN_MASTERY_THRESHOLD } from "@/lib/mastery-status";
import { THEME_PREFERENCES } from "@/lib/theme";
import { GRADE_RECOGNITION_MODES } from "@/lib/question/question-grade";
import { GRADE_SEMESTERS } from "@/lib/grade-options";

const logger = createLogger('api:user');

const userUpdateSchema = z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    password: z.string().optional(),
    educationStage: z.preprocess((val) => (val === '' ? undefined : val), z.enum(["primary", "junior_high", "senior_high", "university"]).optional()),
    enrollmentYear: z.number().optional().nullable(),
    gradeRecognitionMode: z.enum(GRADE_RECOGNITION_MODES).optional(),
    fixedGradeSemester: z.enum(GRADE_SEMESTERS).nullable().optional(),
    confirmBeforeImport: z.boolean().optional(),
    enableGeogebra: z.boolean().optional(),
    enableSvgAnimation: z.boolean().optional(),
    themePreference: z.enum(THEME_PREFERENCES).optional(),
    questionDuplicateThreshold: z.number().min(1).max(100).multipleOf(0.01).optional(),
    masteryThreshold: z.number().int().min(MIN_MASTERY_THRESHOLD).max(MAX_MASTERY_THRESHOLD).optional(),
});

/**
 * GET /api/user
 * 获取当前用户资料；用户不存在时返回 404（而非包装器的 401），保持原有语义
 */
export async function GET() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return unauthorized();
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: {
                name: true,
                email: true,
                educationStage: true,
                enrollmentYear: true,
                gradeRecognitionMode: true,
                fixedGradeSemester: true,
                confirmBeforeImport: true,
                enableGeogebra: true,
                enableSvgAnimation: true,
                themePreference: true,
                questionDuplicateThreshold: true,
                masteryThreshold: true,
                aiDataConsentAt: true,
                // Do not return password
            }
        });

        if (!user) {
            return notFound("User not found");
        }

        logger.debug({ user }, 'Returning user profile');

        return NextResponse.json(user);
    } catch (error) {
        logger.error({ error }, 'Failed to fetch user profile');
        return internalError("Failed to fetch user profile");
    }
}

async function handlePatch(req: Request, { session }: AuthenticatedContext) {
    try {
        const body = await req.json();
        const { name, email, password, educationStage, enrollmentYear, gradeRecognitionMode, fixedGradeSemester, confirmBeforeImport, enableGeogebra, enableSvgAnimation, themePreference, questionDuplicateThreshold, masteryThreshold } = userUpdateSchema.parse(body);

        const updateData: Prisma.UserUpdateInput = {};
        if (gradeRecognitionMode !== undefined) updateData.gradeRecognitionMode = gradeRecognitionMode;
        if (fixedGradeSemester !== undefined) updateData.fixedGradeSemester = fixedGradeSemester;

        // 只有非空字符串才会触发更新
        if (name && name.trim()) updateData.name = name.trim();
        if (educationStage && educationStage.trim()) updateData.educationStage = educationStage.trim();
        if (typeof enrollmentYear === 'number' && !isNaN(enrollmentYear)) {
            updateData.enrollmentYear = enrollmentYear;
        }
        if (typeof confirmBeforeImport === 'boolean') {
            updateData.confirmBeforeImport = confirmBeforeImport;
        }
        if (typeof enableGeogebra === 'boolean') {
            updateData.enableGeogebra = enableGeogebra;
        }
        if (typeof enableSvgAnimation === 'boolean') {
            updateData.enableSvgAnimation = enableSvgAnimation;
        }
        if (themePreference) {
            updateData.themePreference = themePreference;
        }
        if (typeof questionDuplicateThreshold === 'number') {
            updateData.questionDuplicateThreshold = questionDuplicateThreshold;
        }
        if (typeof masteryThreshold === 'number') {
            updateData.masteryThreshold = masteryThreshold;
        }

        // 验证邮箱格式（如果提供了邮箱）
        // 支持标准邮箱和本地邮箱（如 admin@localhost）
        if (email && email.trim()) {
            const emailRegex = /^[^\s@]+@[^\s@]+$/;
            if (!emailRegex.test(email.trim())) {
                return badRequest("Invalid email format");
            }
            updateData.email = email.trim();
        }

        // 验证密码长度（如果提供了密码）
        if (password && password.length > 0) {
            if (password.length < 6) {
                return badRequest("Password must be at least 6 characters");
            }
            if (isDefaultAdminPassword(session.user.role, password)) {
                return badRequest("New password must not be the default password");
            }
            updateData.password = await hash(password, 10);
        }

        const sessionEmail = session.user.email!;
        const updatedUser = await prisma.$transaction(async (tx) => {
            const updated = await tx.user.update({
                where: { email: sessionEmail },
                data: updateData,
                select: {
                    id: true,
                    name: true,
                    email: true,
                    educationStage: true,
                    enrollmentYear: true,
                    gradeRecognitionMode: true,
                    fixedGradeSemester: true,
                    confirmBeforeImport: true,
                    enableGeogebra: true,
                    enableSvgAnimation: true,
                    themePreference: true,
                    questionDuplicateThreshold: true,
                    masteryThreshold: true,
                }
            });
            // 阈值变化后同步已存的 masteryLevel，与按阈值推导的复习状态保持一致
            if (typeof masteryThreshold === 'number') {
                await syncMasteryLevels(tx, updated.id, masteryThreshold);
            }
            return updated;
        });

        const { id: _id, ...profile } = updatedUser;
        return NextResponse.json(profile);
    } catch (error) {
        logger.error({ error }, 'Failed to update user profile');
        if (error instanceof z.ZodError) {
            return validationError("Invalid input", error.issues);
        }
        return internalError("Failed to update user profile");
    }
}

export const PATCH = withUser(handlePatch);

const deleteAccountSchema = z.object({
    password: z.string().min(1),
});

/**
 * DELETE /api/user
 * 普通用户注销自己的账号：校验密码后删除用户，名下数据由数据库级联删除。
 * 管理员不能自助注销，避免实例失去管理员；清空数据请使用系统初始化。
 */
async function handleDelete(req: Request, { user }: AuthenticatedContext) {
    if (user.role === 'admin') {
        return forbidden("Administrators cannot delete their own account");
    }

    const parsed = deleteAccountSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return validationError("Invalid input", parsed.error.issues);
    }

    if (!(await compare(parsed.data.password, user.password))) {
        return badRequest("Incorrect password");
    }

    await prisma.user.delete({ where: { id: user.id } });
    logger.info({ userId: user.id }, 'User deleted own account');
    await notifyAiAccountUsersDeleted([user.id]);

    return NextResponse.json({ success: true });
}

export const DELETE = withUser(handleDelete);

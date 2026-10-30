/**
 * Docker 启动、安装包构建时调用：只维护已有的默认管理员 admin@localhost（恢复管理员角色并启用）。
 * 全新安装不再创建固定密码的管理员，改由服务启动时在日志中打印一次性初始化链接创建（见 src/lib/initialization.ts）。
 */
const { PrismaClient } = require('@prisma/client');

const DEFAULT_ADMIN = {
    email: 'admin@localhost',
    role: 'admin',
    isActive: true,
    educationStage: 'junior_high',
    enrollmentYear: 2025,
};

async function seedAdmin({ prisma }) {
    const existingUser = await prisma.user.findUnique({
        where: { email: DEFAULT_ADMIN.email },
    });

    if (!existingUser) {
        return { action: 'skipped', email: DEFAULT_ADMIN.email };
    }

    await prisma.user.update({
        where: { email: DEFAULT_ADMIN.email },
        data: {
            role: DEFAULT_ADMIN.role,
            isActive: DEFAULT_ADMIN.isActive,
            educationStage: existingUser.educationStage ?? DEFAULT_ADMIN.educationStage,
            enrollmentYear: existingUser.enrollmentYear ?? DEFAULT_ADMIN.enrollmentYear,
        },
    });
    return { action: 'updated', email: DEFAULT_ADMIN.email };
}

async function main() {
    const prisma = new PrismaClient();

    try {
        const result = await seedAdmin({ prisma });
        if (result.action === 'updated') {
            console.log('Existing admin user found. Restored admin role.');
        } else {
            console.log('No default admin user. Create the admin with the one-time setup link printed when the server starts.');
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { seedAdmin, DEFAULT_ADMIN };

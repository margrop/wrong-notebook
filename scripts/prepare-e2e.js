/**
 * E2E 测试前的数据准备（在 prisma db seed 之后运行）：
 * - 全新数据库不再预置管理员，创建（或重置）admin@localhost，密码为 E2E_ADMIN_PASSWORD，供各用例登录；
 * - 另建一个仍使用默认密码的管理员 setup-admin@localhost，专门测试强制改密流程；
 * - 在 app-config.json 中标记安装向导已完成，避免全新数据库让各用例被重定向到向导。
 * 每次运行都会重置这两个账号的密码，可重复执行。
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');

const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'e2e-admin-pass';
const DEFAULT_ADMIN_PASSWORD = '123456';
const SETUP_ADMIN_EMAIL = 'setup-admin@localhost';
// 与 src/lib/config.ts 一致
const CONFIG_FILE_PATH = path.join(process.env.CONFIG_DIR || path.join(process.cwd(), 'config'), 'app-config.json');

// 直接读取并处理不存在的情况，避免先判断再读写之间文件被替换
function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return {};
        throw error;
    }
}

function markSetupCompleted() {
    const config = readConfig();
    if (config.setupCompletedAt) return;
    fs.mkdirSync(path.dirname(CONFIG_FILE_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify({ ...config, setupCompletedAt: new Date().toISOString() }, null, 2));
}

async function main() {
    const prisma = new PrismaClient();
    try {
        const adminHash = await hash(E2E_ADMIN_PASSWORD, 10);
        await prisma.user.upsert({
            where: { email: 'admin@localhost' },
            update: { password: adminHash, role: 'admin', isActive: true },
            create: { email: 'admin@localhost', name: 'Admin', password: adminHash, role: 'admin', isActive: true, educationStage: 'junior_high', enrollmentYear: 2025 },
        });

        const defaultHash = await hash(DEFAULT_ADMIN_PASSWORD, 10);
        await prisma.user.upsert({
            where: { email: SETUP_ADMIN_EMAIL },
            update: { password: defaultHash, role: 'admin', isActive: true },
            create: { email: SETUP_ADMIN_EMAIL, name: 'Setup Admin', password: defaultHash, role: 'admin', isActive: true },
        });

        markSetupCompleted();

        console.log(`[prepare-e2e] admin@localhost 密码已设为 E2E_ADMIN_PASSWORD，${SETUP_ADMIN_EMAIL} 使用默认密码，安装向导已标记完成`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

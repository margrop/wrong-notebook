import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * 全新安装不再创建固定密码的默认管理员：服务启动时会在日志中打印一次性初始化链接，
 * 打开后设置管理员账号（见 src/lib/initialization.ts）。这里只提示当前状态。
 */
async function main() {
    const admins = await prisma.user.count({ where: { role: 'admin' } });
    if (admins > 0) {
        console.log(`Found ${admins} admin user(s). Nothing to seed.`);
        return;
    }
    console.log('No admin user yet. Start the server and open the one-time setup link printed in its log to create one.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

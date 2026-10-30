import { prisma } from "@/lib/prisma";
import { readInitialAdmin, removeInitialAdmin } from "@/lib/initial-admin";
import { createLogger } from "@/lib/logger";
import { ensureSetupToken, removeSetupToken } from "@/lib/setup-token";

const logger = createLogger("initialization");

/** 至少有一个管理员即视为已初始化；全新安装不再预置默认管理员 */
export async function isInitialized(): Promise<boolean> {
    return (await prisma.user.count({ where: { role: "admin" } })) > 0;
}

/** 初始化链接的完整地址；外部访问地址不同时（反向代理、局域网 IP）需替换主机部分 */
export function setupLinkFor(token: string): string {
    const base = (process.env.NEXTAUTH_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
    return `${base}/initialize?token=${encodeURIComponent(token)}`;
}

/** 用安装程序预设的管理员（initial-admin.json）创建账号；成功返回 true，没有或无效时返回 false */
async function createPresetAdmin(): Promise<boolean> {
    let preset;
    try {
        preset = readInitialAdmin();
    } catch (error) {
        logger.error({ error }, "Invalid initial-admin.json; falling back to the setup link");
        removeInitialAdmin();
        return false;
    }
    if (!preset) return false;

    if (await prisma.user.findUnique({ where: { email: preset.email }, select: { id: true } })) {
        logger.error({ email: preset.email }, "Preset admin email already exists; falling back to the setup link");
        removeInitialAdmin();
        return false;
    }
    const user = await prisma.user.create({
        data: { email: preset.email, name: preset.name || "Admin", password: preset.passwordHash, role: "admin", isActive: true },
        select: { id: true },
    });
    removeInitialAdmin();
    removeSetupToken();
    logger.info({ userId: user.id, email: preset.email }, "Admin created from installer settings");
    return true;
}

/**
 * 服务启动时调用：尚未初始化时，优先使用安装程序预设的管理员；
 * 没有预设时生成令牌并在日志中打印初始化链接。已初始化时删除残留的令牌和预设文件
 */
export async function announceSetupLink(): Promise<void> {
    try {
        if (await isInitialized()) {
            removeSetupToken();
            removeInitialAdmin();
            return;
        }
        if (await createPresetAdmin()) return;
        const link = setupLinkFor(ensureSetupToken());
        // 未配置 NEXTAUTH_URL 时链接主机为 localhost，从其他设备访问需换成服务器地址
        const hostHint = process.env.NEXTAUTH_URL ? "" : "（从其他设备访问时，把 localhost 换成服务器的 IP 或域名）";
        logger.warn({ link }, `尚未创建管理员。请打开以下初始化链接设置管理员账号（仅可使用一次）${hostHint}：${link}`);
    } catch (error) {
        // 只读文件系统（如 Vercel）或数据库尚未就绪时不影响服务启动
        logger.error({ error }, "Failed to prepare setup link");
    }
}

import { prisma } from "@/lib/prisma";
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

/**
 * 服务启动时调用：尚未初始化时生成令牌并在日志中打印初始化链接；
 * 已初始化时删除残留的令牌文件
 */
export async function announceSetupLink(): Promise<void> {
    try {
        if (await isInitialized()) {
            removeSetupToken();
            return;
        }
        const link = setupLinkFor(ensureSetupToken());
        // 未配置 NEXTAUTH_URL 时链接主机为 localhost，从其他设备访问需换成服务器地址
        const hostHint = process.env.NEXTAUTH_URL ? "" : "（从其他设备访问时，把 localhost 换成服务器的 IP 或域名）";
        logger.warn({ link }, `尚未创建管理员。请打开以下初始化链接设置管理员账号（仅可使用一次）${hostHint}：${link}`);
    } catch (error) {
        // 只读文件系统（如 Vercel）或数据库尚未就绪时不影响服务启动
        logger.error({ error }, "Failed to prepare setup link");
    }
}

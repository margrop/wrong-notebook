import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * 安装程序预先设置的管理员（如飞牛OS 安装向导中填写的邮箱和密码）：
 * 安装脚本把邮箱和 bcrypt 密码哈希写入配置目录的 initial-admin.json（不含明文密码），
 * 服务首次启动时据此创建管理员并删除该文件，不再需要初始化链接
 */
const initialAdminSchema = z.object({
    email: z.string().trim().regex(/^[^\s@]+@[^\s@]+$/),
    name: z.string().trim().min(1).max(50).optional(),
    // bcrypt 哈希，如 $2a$12$…
    passwordHash: z.string().regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/),
});

export type InitialAdmin = z.infer<typeof initialAdminSchema>;

function initialAdminFilePath(): string {
    return path.join(process.env.CONFIG_DIR || path.join(process.cwd(), "config"), "initial-admin.json");
}

/** 读取预设管理员；没有文件时返回 null，内容无效时抛出错误 */
export function readInitialAdmin(): InitialAdmin | null {
    let text: string;
    try {
        text = fs.readFileSync(initialAdminFilePath(), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    return initialAdminSchema.parse(JSON.parse(text));
}

export function removeInitialAdmin(): void {
    fs.rmSync(initialAdminFilePath(), { force: true });
}

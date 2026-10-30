import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * 一次性初始化令牌：全新安装（还没有管理员）时生成，保存在配置目录，
 * 只有能看到启动日志或数据目录的人才能拿到，用它打开 /initialize 创建管理员；创建后删除。
 * 配置目录与 app-config.json 相同（安装包通过 CONFIG_DIR 指定，默认 ./config）
 */
function tokenFilePath(): string {
    return path.join(process.env.CONFIG_DIR || path.join(process.cwd(), "config"), "setup-token");
}

function readTokenFile(): string | null {
    try {
        const token = fs.readFileSync(tokenFilePath(), "utf8").trim();
        return token || null;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

/** 读取已有令牌，没有时生成一个；同时启动的另一个进程已写入时沿用它的 */
export function ensureSetupToken(): string {
    const saved = readTokenFile();
    if (saved) return saved;
    const token = randomBytes(24).toString("base64url");
    const file = tokenFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
        // wx：文件已存在时失败，不覆盖别的进程刚生成的令牌
        fs.writeFileSync(file, token, { mode: 0o600, flag: "wx" });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const other = readTokenFile();
        if (other) return other;
        fs.writeFileSync(file, token, { mode: 0o600 });
    }
    return token;
}

export function removeSetupToken(): void {
    fs.rmSync(tokenFilePath(), { force: true });
}

/** 比较前先取摘要，长度不同也走恒定时间比较 */
export function verifySetupToken(input: unknown): boolean {
    if (typeof input !== "string" || !input) return false;
    const saved = readTokenFile();
    if (!saved) return false;
    const digest = (value: string) => createHash("sha256").update(value).digest();
    return timingSafeEqual(digest(input), digest(saved));
}

export interface SetupTokenClaim {
    /** 管理员创建成功：删除令牌 */
    consume(): void;
    /** 创建失败：放回令牌，链接仍可再用 */
    release(): void;
}

/**
 * 校验并占用令牌：把令牌文件改名，同一时刻只有一个请求能改名成功，
 * 避免两个请求同时用同一链接各创建一个管理员
 */
export function claimSetupToken(input: unknown): SetupTokenClaim | null {
    if (!verifySetupToken(input)) return null;
    const file = tokenFilePath();
    const claimed = `${file}.${randomBytes(6).toString("hex")}.claimed`;
    try {
        fs.renameSync(file, claimed);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    return {
        consume: () => fs.rmSync(claimed, { force: true }),
        release: () => fs.renameSync(claimed, file),
    };
}

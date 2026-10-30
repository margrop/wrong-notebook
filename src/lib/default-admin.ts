/**
 * 安装时创建的默认管理员凭据（prisma/seed.ts、scripts/seed-admin.js）。
 * 管理员仍使用默认密码登录时，必须先修改密码才能使用其他页面。
 */
export const DEFAULT_ADMIN_EMAIL = 'admin@localhost';
export const DEFAULT_ADMIN_PASSWORD = '123456';

/** 管理员是否正在使用默认密码（只看明文输入，不查库） */
export function isDefaultAdminPassword(role: string | null | undefined, password: string): boolean {
    return role === 'admin' && password === DEFAULT_ADMIN_PASSWORD;
}

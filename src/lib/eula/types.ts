/** /api/eula/status 与同意接口的响应，前后端共用 */
export interface EulaStatus {
    /** 管理员需要重新同意（曾同意的版本低于当前版本）；普通用户始终为 false */
    pending: boolean;
    current: string;
    /** 已同意的版本，从未同意时为 null */
    accepted: string | null;
    acceptedAt: string | null;
    /** 当前版本的变更摘要 */
    changes: { zh: string[]; en: string[] };
}

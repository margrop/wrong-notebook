/**
 * 使用协议版本（只针对管理员，见 doc/TELEMETRY_DESIGN.md §6）。
 * 协议的实质内容（权利义务、数据收集范围、外发对象）变化时升版本，并在 EULA_CHANGES 补上变更摘要；
 * 纯排版、错别字修改不升版本。
 */
export const EULA_VERSION = "v1";

/** 每个版本相对上一版的变更摘要，升级对话框会展示 */
export const EULA_CHANGES: Record<string, { zh: string[]; en: string[] }> = {
    v1: { zh: ["首个版本"], en: ["Initial version"] },
};

# Fork 扩展点

本文档汇总 wrong-notebook 上游为 fork 项目预留的通用扩展点。fork 项目（例如「AI 题库」）可以只修改一个配置文件或注册一个扩展，而不改动上游业务文件，便于长期跟随上游更新。

## 导航与品牌

文件：`src/lib/app-navigation.ts`

fork 项目可在此文件中：

- **增删导航项**：编辑 `NAV_ITEMS` 数组。每个导航项包含 `key`（对应 `translations.ts` 中 `t.nav` 的翻译 key）、`href`、`icon`（lucide 图标）与 `match(pathname)` 高亮规则。
- **修改无导航路径**：编辑 `BARE_PATHS` 正则数组（登录、注册、打印预览等页面不显示全局导航）。
- **替换品牌图标**：修改 `APP_BRAND.iconSrc`，无需改动 `src/components/app-shell.tsx`。
- **新增翻译 key**：在 `src/lib/i18n/zh.ts` 与 `src/lib/i18n/en.ts` 的 `nav` 节（中英文同步）中添加对应 key。

移动端底部导航的列数按 `NAV_ITEMS.length` 自动计算，无需手工调整样式。

纯函数 `isBarePath(pathname)` 与 `findActiveNavKey(pathname)` 已导出供测试和外部使用。

## 备份扩展数据

文件：`src/lib/backup-extensions.ts`

导出文件从 version 7 起新增 `extensions` 命名空间，fork 项目的私有数据（如题库元数据）可放入 `extensions.<key>`，自行管理版本，不占用上游 `version` 序号。

在 `BACKUP_EXTENSIONS` 数组中注册扩展：

```ts
import type { BackupExtension } from "@/lib/backup-extensions";
import { BACKUP_EXTENSIONS } from "@/lib/backup-extensions";

const bankMeta: BackupExtension = {
    key: "bank-meta",           // 小写字母数字与短横线
    version: 1,                 // 扩展自身版本
    async export(ctx) {
        // ctx.userIds 为 null 表示管理员导出全部用户
        return { items: [] };
    },
    async import(ctx, payload) {
        // ctx.tx 为事务客户端；ctx.subjectIdMap / errorItemIdMap 等提供旧 ID → 新 ID 映射
        // payload.version 大于扩展自身 version 时上游已跳过
        return 0; // 返回导入条数
    },
};

BACKUP_EXTENSIONS.push(bankMeta);
```

导入规则：

- `extensions` 缺失（旧版文件）或不是对象 → 跳过
- 未注册的 key → 跳过并 `logger.warn`
- 已注册扩展的 `payload.version` 大于扩展自身 version → 跳过并 warn（新版文件导入旧程序）
- 扩展 `import` 抛错 → 整个导入事务回滚（与核心数据一致）
- 导入统计 `stats.extensionsImported` 记录每个扩展的导入条数

`BackupImportContext` 提供的 ID 映射（以导入路由中实际存在的映射为准）：

| 字段 | 说明 |
| --- | --- |
| `tx` | Prisma 事务客户端 |
| `userIdMap` | 旧用户 ID → 新用户 ID；管理员全量导入保留原用户 ID，非管理员导入映射到当前用户 |
| `subjectIdMap` | 错题本 ID 映射 |
| `errorItemIdMap` | 错题 ID 映射 |
| `tagIdMap` | 自定义标签 ID 映射 |
| `examPaperIdMap` | 试卷 ID 映射 |
| `examQuestionIdMap` | 试卷题目 ID 映射 |

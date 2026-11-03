# Fork 扩展点

本文档汇总 wrong-notebook 上游为 fork 项目预留的通用扩展点。fork 项目（例如「AI 题库」）可以只修改一个配置文件或注册一个扩展，而不改动上游业务文件，便于长期跟随上游更新。

## 导航与品牌

文件：`src/lib/app-navigation.ts`

fork 项目可在此文件中：

- **增删导航项**：编辑 `NAV_ITEMS` 数组。每个导航项包含 `key`（对应 `translations.ts` 中 `t.nav` 的翻译 key）、`href`、`icon`（lucide 图标）与 `match(pathname)` 高亮规则。
- **修改无导航路径**：编辑 `BARE_PATHS` 正则数组（登录、注册、打印预览等页面不显示全局导航）。
- **替换品牌图标**：修改 `APP_BRAND.iconSrc`，无需改动 `src/components/app-shell.tsx`。
- **新增翻译 key**：在 `src/lib/translations.ts` 的 `nav` 节（中英文同步）中添加对应 key。

移动端底部导航的列数按 `NAV_ITEMS.length` 自动计算，无需手工调整样式。

纯函数 `isBarePath(pathname)` 与 `findActiveNavKey(pathname)` 已导出供测试和外部使用。

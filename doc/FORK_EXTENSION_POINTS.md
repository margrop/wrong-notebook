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

## 界面文案

文件：`src/lib/i18n/overrides.ts`

fork 项目可覆盖上游已存在的文案 key，或维护自己的新文案，而不改动上千行的 `src/lib/i18n/zh.ts` / `en.ts` 主文件。

### 覆盖已有文案

`TRANSLATION_OVERRIDES` 的类型是 `{ zh?: DeepPartial<Translations>; en?: DeepPartial<Translations> }`，只允许覆盖已存在的 key——拼错 key 会在编译期报错。上游此对象为空，fork 在自己模块中维护覆盖内容：

```ts
// src/lib/i18n/bank-zh.ts（fork 自建文件）
import type { DeepPartial } from "@/lib/i18n/overrides";
import type { Translations } from "@/lib/translations";

export const bankZh: DeepPartial<Translations> = {
    pageTitle: {
        base: "AI题库",
        home: "录入题目",
    },
};
```

```ts
// src/lib/i18n/overrides.ts 中赋值（fork 私有改动）
import { bankZh } from "@/lib/i18n/bank-zh";
export const TRANSLATION_OVERRIDES = { zh: bankZh };
```

合并规则：仅普通对象递归深合并；数组与函数整体替换；`translations.en` / `translations.zh` 在未覆盖时与 `en` / `zh` 原对象严格一致。

### fork 自有文案

上游不为 fork 预留新 key。fork 的自有页面文案应放在自己的模块（如 `src/lib/i18n/bank-zh.ts`）中，并通过自己的 hook 结合 `useLanguage()` 读取当前语言：

```ts
// src/lib/hooks/use-bank-translations.ts（fork 自建文件）
import { useLanguage } from "@/contexts/LanguageContext";
import { bankZh } from "@/lib/i18n/bank-zh";
import { bankEn } from "@/lib/i18n/bank-en";

export function useBankTranslations() {
    const { language } = useLanguage();
    return language === "zh" ? bankZh : bankEn;
}
```

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

## 组卷选题来源

文件：`src/lib/exam/exam-sources.ts`

「举一反三」与「原题直出」两种模式的选题逻辑可插拔：上游默认注册 `error-items`（从错题本按掌握情况与抽题规则选题），fork 项目可注册自己的 provider（如按知识点×题型×难度配比从 AI 题库选题），复用后续的出题、打印、成绩记录流程。

```ts
import type { ExamSourceProvider } from "@/lib/exam/exam-sources";
import { registerExamSourceProvider } from "@/lib/exam/exam-sources";

const bankProvider: ExamSourceProvider = {
    key: "question-bank",
    select: async (userId, selection) => {
        // 按 fork 项目的规则选题，返回与默认实现相同结构的原题列表
        // 每项需包含 { id, shortId, questionText?, practiceCount, inExam }
        return [];
    },
};

registerExamSourceProvider(bankProvider);
```

调用方在创建试卷时通过 `source` 字段指定来源：

```ts
// POST /api/exams
{ "subjectIds": ["..."], "scope": "unmastered", "count": 10, "difficulty": "hard", "source": "question-bank" }
```

- `source` 缺省为 `error-items`（错题本来源），未注册的 source 返回 `VALIDATION_ERROR`（`code: invalid_source`）。
- `source` 目前不持久化到试卷：重试失败题目时不重新选题，只重新生成已有题目的答案，因此不影响现有流程；如需在后续流程（如打印、成绩分析）中感知来源，fork 项目需自行扩展。

## 题目保存钩子

文件：`src/lib/question/question-save-hooks.ts`

fork 项目可在题目入库时同步写自己的数据（如题库索引、自定义关联表），只需注册钩子，无需改动 `question-save.ts`：

```ts
import type { QuestionSaveHook } from "@/lib/question/question-save-hooks";
import { registerQuestionSaveHook } from "@/lib/question/question-save-hooks";

const myHook: QuestionSaveHook = async (tx, event) => {
    // event: { userId, errorItemId, duplicate, origin, input }
    await tx.myTable.create({ data: { errorItemId: event.errorItemId } });
};

registerQuestionSaveHook(myHook);
```

事务语义：

- 钩子在错题写入的**同一数据库事务**内执行，位于 `options.afterWrite` 之后。
- 任何钩子抛错都会使整笔事务回滚（与 `afterWrite` 一致），并记录 `logger.error`。
- 重复题（`duplicate: true`）同样触发钩子，此时 `errorItemId` 指向原有题目，未新建错题。

`origin` 字段区分入库路径：`manual`（单题保存 API）、`import-task`（识别导入任务）、`openclaw`（Openclaw 批量上传）。

注意：

- 钩子在事务内运行，执行时间直接拉长事务持有时间；**不要在钩子里调用外部网络或执行耗时计算**，只做同库的数据写入。
- 进程内按注册顺序依次执行；`clearQuestionSaveHooksForTest` 仅供测试清空注册表。

## AI 账户：额度、AI 配置与用量

文件：`src/lib/ai/account.ts`（接口）、`src/lib/ai/account-default.ts`（默认实现）

AI 调用前的额度判断、每个用户使用的 AI 配置、每次补全的用量记录，以及用户删除后的清理，都集中在 `AiAccountProvider` 接口中。默认实现即上游行为：按「每人每日 AI 次数」限额、全站共用一套 AI 配置、用量写入本地 `AiCompletion` 表。

| 方法 | 调用时机 | 默认实现 |
| --- | --- | --- |
| `authorize(scope)` | `consumeAiQuota` 中，AI 数据授权检查通过之后 | 每日次数上限，管理员不受限制 |
| `resolveConfig(scope)` | 每次 `getAIService({ userId, kind })` | 返回 `null`，使用全站配置 |
| `record(scope, provider, event)` | 每次补全结束（成功或失败） | 写入 `AiCompletion` |
| `onUserDeleted(userId)` | 自助注销、管理员删除用户、系统初始化删除用户成功之后 | 无操作 |

约定：

- AI 数据授权检查在 `authorize` 之前完成，扩展不能跳过。
- `authorize` 返回 `null` 放行；拒绝时返回 `{ code, details }`，接口返回 429，前端统一提示额度用完。`code` 为 `AI_DAILY_LIMIT_EXCEEDED`（每日次数上限，提示明天再试）或 `AI_QUOTA_INSUFFICIENT`（额度不足，提示补充额度）。`authorize` 抛错时按放行处理并记日志。
- `resolveConfig` 返回的配置只支持 OpenAI 兼容接口：`{ provider, baseUrl, apiKey, model }`，其中 `provider` 是记入用量的渠道名。同一地址和模型的调用共用并发名额，与 API Key 无关。
- `record`、`onUserDeleted` 出错只记日志，不影响业务。
- 需要保存用户在外部服务的账号（对应关系、凭据）时，使用 `ExternalAccount` 表：按 `userId + provider` 唯一，`secret` 由扩展自行加密。该表不与 User 建外键、不进入备份，用户删除后记录仍在，供 `onUserDeleted` 读取并清理，清理完成后由扩展删除。
- `scope.kind` 为触发调用的操作（与 `AiUsage.kind` 相同），后台的掌握概率评估为 `mastery`，不经过 `authorize`。

### 替换实现

实现放在 `src/extensions/local/`（已加入 `.gitignore`，上传前检查也会拒绝该目录），模块导出名为 `aiAccountProvider` 的对象。可以复用默认实现，只替换需要改变的方法：

```ts
// src/extensions/local/ai-account.ts（不入库）
import type { AiAccountProvider } from "@/lib/ai/account";
import { aiAccountProvider as base } from "@/lib/ai/account-default";

export const aiAccountProvider: AiAccountProvider = {
    ...base,
    resolveConfig: async (scope) => ({
        provider: "gateway",
        baseUrl: "http://gateway.internal/v1",
        apiKey: await lookupUserKey(scope.userId),
        model: "gpt-4o-mini",
    }),
};
```

构建（包括 `npm run dev`）时用环境变量指定实现文件，路径相对项目根目录：

```bash
AI_ACCOUNT_EXTENSION=src/extensions/local/ai-account.ts npm run build
```

Docker 镜像构建时传入同名构建参数，实现文件需在构建上下文中（`src/extensions/local/` 未被 `.dockerignore` 排除）。构建完成后 standalone 目录会清理掉源码，实现的源文件不会进入最终镜像：

```bash
docker build --build-arg AI_ACCOUNT_EXTENSION=src/extensions/local/ai-account.ts -t wrong-notebook-custom .
```

`next.config.ts` 把模块 `@wrong-notebook/ai-account` 指向该文件，未设置时指向默认实现；替换只在构建时生效，修改后需重新构建。Vitest 始终使用默认实现。

# AGENTS.md

本文件为在本仓库工作的 AI 代理（Claude Code、Codex、Cursor 等）提供约定。

## 项目概览

wrong-notebook 是一个错题本 Web 应用：上传题目图片或文字，由 AI 识别、解析并打知识点标签，支持错题本管理、练习、统计与打印导出。

- 框架：Next.js 16（App Router）+ React 19 + TypeScript
- 样式：Tailwind CSS 4 + Radix UI（shadcn/ui 风格组件，见 `components.json`）
- 数据：Prisma 5 + SQLite（`DATABASE_URL`，开发默认 `file:./dev.db`）
- 认证：NextAuth v4（用户名密码；Openclaw 集成可用 API Key）
- AI：Gemini / OpenAI / Azure / Anthropic，多提供商封装于 `src/lib/ai/`
- 测试：Vitest（单元、集成）、Playwright（E2E）、Python unittest（部署脚本）

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `src/app/` | 页面与路由；`src/app/api/` 为 API 路由 |
| `src/components/` | React 组件；`ui/` 为基础组件 |
| `src/lib/` | 业务逻辑与工具：`ai/`、`auth.ts`、`prisma.ts`、`logger.ts`、`api-errors.ts`、`translations.ts` 等 |
| `src/lib/tag-data/` | 各学科知识点标签数据 |
| `src/__tests__/unit`、`src/__tests__/integration` | Vitest 测试 |
| `e2e/` | Playwright 测试 |
| `prisma/` | `schema.prisma`、迁移、种子数据 |
| `scripts/` | CI、部署、数据迁移和种子脚本；`scripts/package/` 为安装包构建 |
| `packaging/` | npm、桌面版（Electron）、飞牛OS 安装包的启动器与配置，安卓 App（`android/`，单机版与客户端版），见 `doc/INSTALL_PACKAGES.md` |
| `doc/` | 项目文档（部署、日志、Markdown、HTTPS 等） |

## 常用命令

```bash
npm ci --registry=https://registry.npmjs.org
npx prisma generate
npm run dev                 # 开发服务器（0.0.0.0:3000）
npm run lint                # 出现任何警告即失败
npm run test:unit
npm run test:integration
npm test                    # 全部 Vitest 测试
npm run test:coverage       # 覆盖率，低于 vitest.config.ts 中的阈值时失败
npm run test:e2e            # Playwright
bash scripts/ci.sh          # 完整 CI（要求 Node.js 22 及以上，含生产构建）
```

默认 registry 设为国内镜像（如 npmmirror）时，新发布的包下载很慢，镜像地址还会被写进 `package-lock.json`。安装或升级依赖时指定官方源（`--registry=https://registry.npmjs.org`，运行 `scripts/ci.sh` 时设置 `npm_config_registry`），提交前确认锁文件中没有 `npmmirror`。

## 语言

所有回复、代码注释和 commit message 使用简体中文。

## 代码规范

- TypeScript：避免 `any`，用 `unknown` 或具体类型；类型导入使用 `import type`。捕获的错误用 `@/lib/error-message` 的 `getErrorMessage` / `getApiErrorMessage` 取文本。
- Lint 必须零警告。确需忽略规则时，只在调用处用 `eslint-disable-next-line` 并写明原因（如 effect 中的数据请求），不要整文件关闭。
- React：组件需有 Props 类型；超过约 200 行的组件应拆分，子组件放在以页面或功能命名的目录（如 `src/components/settings/`、`error-detail/`），可复用逻辑抽成 `src/lib/use-*.ts` hook。
- 导入顺序：React/Next → 第三方 → `@/components` → `@/lib` → types → styles。
- 路径别名 `@/` 指向 `src/`。
- API 错误使用 `@/lib/api-errors`；日志后端用 `@/lib/logger`，前端用 `@/lib/frontend-logger`，不要直接 `console.log`。
- 界面文本放在 `@/lib/translations.ts`，组件中用 `t.section.key`，缺省回退英文。中英文 key 必须一致（`translations.test.ts` 会检查）。
- 页面须同时适配 PC 和移动端（移动优先）。
- 修改 AI 调用时同步更新所有提供商（`gemini-provider.ts`、`openai-provider.ts`、`azure-provider.ts`、`anthropic-provider.ts`），提示词集中在 `prompts.ts`。
- MiniMax、智谱 GLM、DeepSeek、Kimi、千问 Qwen 等国产大模型官方渠道复用 `OpenAIProvider`，默认地址和模型集中在 `src/lib/ai/vendor-presets.ts`；新增渠道只需加预设并同步文档与测试。

## 安全

- 密钥与凭据放在 `.env` 或 `config/app-config.json`（均不入库），新增环境变量需同步 `.env.example`。
- 数据库访问使用 Prisma 参数化查询；校验所有用户输入（优先 zod），防范 XSS。
- 不在代码、日志或提交中写入 SSH 私钥、Portainer 令牌、API Key。

## 数据库

- 修改 `prisma/schema.prisma` 后使用正式迁移（`npx prisma migrate dev --name <名称>`），并提交 `prisma/migrations/`。
- 生产环境以 `PRESERVE_EXISTING_DATA=true` 运行，只执行迁移；迁移必须兼容已有数据。

## 测试

- 修改逻辑代码后运行 `npm run test:unit && npm run test:integration`；仅改文档、样式、注释时可跳过。
- 修改导出、导入或新增需要备份的字段和表时，同步更新 `src/app/api/export`、`src/app/api/import` 与 `src/__tests__/integration/data-backup.test.ts`。
- 测试失败先修复再重跑；不要为通过测试而删除或弱化断言。
- 除非用户要求或运行完整 CI，不主动执行 `npm run build`。

## Git 与提交

- `main` 为公开主线，禁止反向合并私有部署分支。向 GitHub 推送前运行 `python3 scripts/check-public-history.py <待推送引用>`；每个工作副本用 `git config core.hooksPath .githooks` 启用上传前检查。
- 分支边界、检查和公开发布流程见 `doc/BRANCH_WORKFLOW.md`。

- 向 GitHub 推送前展示 `git status` 与拟推送的 `git diff`，经用户确认后再执行 `git push`（包括分支、标签和历史重写）。本地 `git add` / `git commit` 及推送 Gitea 无需单独确认。
- 发布版本默认打预览版标签 `v年.月.日-n`（如 `v2026.10.22-1`，`n` 为当天序号，月日不补零），推送前确认对应提交的 GitHub CI（含 E2E）已通过；正式版标签 `v年.月.日` 必须由用户确认后才能创建和推送。详见 `doc/release-guide.md`。
- 提交信息格式：`<type>: <中文描述>`，type 取 feat / fix / docs / style / refactor / test / chore / ci。
- 提交信息中不添加 AI 署名。
- 按功能拆分提交：一次任务包含多个相互独立的需求时，每个需求单独提交；同一需求涉及多个可独立交付的部分（如接入多个提供商）时也逐个提交。每个提交都应能独立通过测试，并包含该功能对应的测试与文档改动；无关的格式化、重构不要混入功能提交。
- `main` 为公开主线；公开远程名称为 `github`。私有部署分支仅推送到受限远程，禁止将其提交或合并记录带入公开历史。

## 文档同步

- 功能、配置项或默认值变化时，同步更新 `README.md` 与 `README.en.md`，以及受影响的 `doc/`、`doc/wiki/` 页面；Wiki 中文页面改动时同步更新 `doc/wiki/en/` 中对应的英文页面，发布流程见 `doc/WIKI_PUBLISHING.md`。
- 面向用户的功能变化（如新增 AI 提供商、安装方式）同时更新官网项目 `../wrong-notebook-github-pages`（中文 `index.html` 与英文 `en/index.html`），该项目单独提交并推送。

## 临时文件

临时脚本、日志、截图等放到 `mktemp -d` 创建的系统临时目录，不要留在仓库根目录或家目录。

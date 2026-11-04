# 开发与贡献

开发环境初始化见[快速开始](Quick-Start)。提交改动前，阅读仓库的 [AGENTS.md](https://github.com/margrop/wrong-notebook/blob/main/AGENTS.md) 和[公开主线工作流](https://github.com/margrop/wrong-notebook/blob/main/doc/BRANCH_WORKFLOW.md)。

## 技术栈与代码入口

项目采用 Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4、Radix UI、Prisma 5、SQLite 与 NextAuth v4；公式通过 KaTeX 渲染。

| 目录或文件 | 职责 |
| --- | --- |
| `src/app/` | 页面与 API 路由 |
| `src/components/` | 业务组件和基础 UI |
| `src/lib/ai/` | AI 提供商公共基类与四家提供商、提示词（`prompts/`）、结果结构与校验 |
| `src/lib/config/` | 全局设置与配置文件读取 |
| `src/lib/question/question-deduplication.ts` | 导入判重与重复作答记录 |
| `src/lib/mastery.ts`、`src/lib/exam/exam.ts` | 掌握评估与试卷生成 |
| `src/lib/date-time.ts` | 应用时区、显示与统计边界 |
| `src/lib/translations.ts`、`src/lib/i18n/` | 界面文本（入口与按语言拆分的文案） |
| `prisma/` | 数据模型、正式迁移和初始化数据 |
| `src/__tests__/`、`e2e/`、`tests/publication/` | 单元、集成、E2E 与公开发布检查测试 |
| `scripts/`、`doc/` | 开发维护脚本与专项文档 |

AI 请求由服务端选择提供商并调用外部服务，业务数据经 Prisma 存入 SQLite。后台任务列表存于进程内存并同步写入配置目录的 `background-tasks.json`，重启后只保留记录、不会恢复执行，不能用它替代持久化任务队列。

拍照识别使用数据库中的 `ImportTask`（`/api/import-tasks`）：上传后立即返回任务编号，识别与入库通过 `after()` 在响应后执行，结果、草稿与最终错题编号持久保存。状态迁移用带条件的 `updateMany` 抢占，错题写入与任务标记已保存在同一事务提交；执行中的任务记录进程启动编号，单进程部署重启后立即判为中断，多实例（Vercel）按心跳超时判断。`/api/analyze` 保留为同步接口，与任务共用 `src/lib/question/question-analysis.ts`；保存与「添加错题」共用 `src/lib/question/question-save.ts`。

HEIC/HEIF 转换依赖 `heic-to`（LGPL-3.0，内含 libheif、libde265 与 Emscripten 运行时），只在浏览器无法直接解码时动态加载。其第三方说明与完整许可证文本放在 `public/third-party-licenses/heic-to/`，随 `public/` 进入各分发形式；升级 `heic-to` 时须同步核对该目录中的版本、许可证文本与上游源码链接。

## 常用检查

### 列表接口的数据范围

`GET /api/error-items/list` 默认只返回卡片所需字段，标签只返回名称；不包含原图、OCR、答案、解析、配图、动画或历史练习。详情使用 `GET /api/error-items/:id`；打印预览通过列表接口的 `view=print` 参数额外读取答案、解析、配图、年级学期、卷别和错题本名称；原图不随列表返回，`originalImageUrl` 换成 `GET /api/error-items/:id/image?v=<更新时间>` 链接，由页面懒加载，点击打印前再统一加载完成。图片接口只输出 PNG、JPEG、WebP、GIF 位图，链接随原图替换而变化，可长期缓存。两种视图使用相同的认证、用户范围、筛选和分页规则，不能将默认列表响应当成完整的 `ErrorItem`。

`src/__tests__/integration/error-list-payload.test.ts` 使用独立的 SQLite 数据库验证大图片、动画、分页与打印；18 题默认响应必须小于 12 KiB，防止重新把大字段带回列表。配对测量方法与报告见仓库 `perf/` 目录。

### 检查命令

```bash
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
```

运行 `npm run test:e2e` 时，启动器会自动准备隔离的生产应用、正式迁移后的临时 SQLite、测试账号及本地 Mock AI。模型仅使用固定假 Key，运行时禁止访问外部模型，也不复用现有开发服务或应用配置。报告保存在系统临时目录，命令结束时输出路径。筛选示例：`npm run test:e2e -- --grep E2E-M01`。

CI 会运行 `npm run lint`，出现任何 ESLint 错误或警告都会失败。

`main` 与 PR CI 还会在原生 amd64、arm64 环境中使用正式 Dockerfile 完整构建镜像，验证 Alpine 内的 Vitest、脚本语法检查、数据库初始化与生产构建，检查过程不推送镜像。`.dockerignore` 须保留单元测试复用的 `e2e/support` 模块，浏览器用例及测试产物仍排除在构建上下文外。

`npm run test:coverage` 统计 `src/lib` 与 `src/app/api` 的测试覆盖率，低于 `vitest.config.mts` 中的阈值时失败；CI 会在任务摘要中显示覆盖率并上传报告。

`npm test` 运行全部 Vitest 测试。E2E 的环境要求与启动方式以仓库中的 [`playwright.config.ts`](https://github.com/margrop/wrong-notebook/blob/main/playwright.config.ts) 为准。

完整 CI 要求 Node.js 22 及以上、Python 3，并包含依赖安装、Prisma Client 生成、ESLint、Vitest、公开发布检查、脚本语法检查和生产构建：

```bash
bash scripts/ci.sh
```

逻辑修改后至少运行单元和集成测试。仅修改文档、样式或注释时可按仓库约定跳过逻辑测试；除非明确要求或运行完整 CI，不主动执行生产构建。

## Fork 扩展点

fork 项目（例如「AI 题库」）可通过上游预留的扩展点定制功能而尽量少改上游文件，详见 [doc/FORK_EXTENSION_POINTS.md](https://github.com/margrop/wrong-notebook/blob/main/doc/FORK_EXTENSION_POINTS.md)。

## 实现约定

- 回复、代码注释和提交说明使用简体中文，提交格式为 `type: 中文描述`。
- TypeScript 避免 `any`，类型导入使用 `import type`，路径别名 `@/` 指向 `src/`。
- React 组件定义 Props 类型，较大的组件拆分；页面兼顾移动端与桌面端。
- 界面文本进入 `translations.ts`，API 错误使用 `api-errors`，前后端分别使用项目日志工具。
- 用户输入优先用 zod 校验，数据库查询使用 Prisma 参数化接口。

## 修改 AI 功能

AI 业务方法统一实现在 `src/lib/ai/base-provider.ts`，Gemini、OpenAI、Azure、Anthropic 四个提供商只实现请求传输与各自的请求差异，新增 AI 功能只需修改基类。提示词集中在 `prompts/` 目录；生成题目的题型与格式契约还由 `generated-question.ts` 等模块校验。

验证时覆盖正常结果、格式异常、超时和输出截断。变更输出结构后，也要检查练习、试卷、配图和重新解答等调用方。

## 数据库变更

修改 `prisma/schema.prisma` 后，在开发数据库中生成正式迁移并提交迁移目录：

```bash
npx prisma migrate dev --name change_name
```

生产部署使用正式迁移并保持 `PRESERVE_EXISTING_DATA=true`，迁移需兼容已有账户和题目数据。不要用开发数据库重置命令替代生产迁移。

## 公开主线与发布

`main` 仅包含可公开的源码、通用部署示例和文档，公开远程按仓库约定命名为 `github`。私有部署分支只从公开主线接收变更，禁止反向合入公开历史。

每个工作副本启用钩子，公开推送前运行检查：

```bash
git config core.hooksPath .githooks
python3 scripts/check-public-history.py main
```

推送到 GitHub 前展示 `git status` 与拟推送差异，并取得确认；分支、标签和历史重写都适用。检查应覆盖实际待推送引用，不能只检查工作区当前文件。

版本号采用发布日期标签，镜像发布步骤见[版本发布指南](https://github.com/margrop/wrong-notebook/blob/main/doc/release-guide.md)。凭据使用 `.env` 或未入库的配置文件；新增环境变量同步 `.env.example`。截图、日志和实验脚本放在系统临时目录。

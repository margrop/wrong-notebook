# 快速开始

普通部署推荐使用 [Docker 镜像](Deployment)。需要调试或修改源码时，按本页准备本地环境。

## 环境要求

- Node.js 22 或更新版本（推荐 24），以及 npm。
- Git；运行完整 CI 时还需要 Python 3。
- 可访问所选 AI 服务的网络，以及相应的 API 凭据。

数据库默认使用 SQLite，不需要额外部署数据库服务。

## 获取代码与安装依赖

```bash
git clone https://github.com/margrop/wrong-notebook.git
cd wrong-notebook
npm ci
cp .env.example .env
```

编辑 `.env`，至少确认数据库路径和会话密钥：

```dotenv
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="替换为随机生成的密钥"
NEXTAUTH_URL="http://localhost:3000"
```

运行 `openssl rand -base64 32` 生成 `NEXTAUTH_SECRET`。`file:./dev.db` 相对于 `prisma/schema.prisma`，对应 `prisma/dev.db`。

AI 凭据可以稍后登录网页，在管理员设置中填写；详见 [AI 模型配置](AI-Configuration)。

## 初始化新数据库

以下步骤适用于首次创建的开发数据库：

```bash
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/rebuild-system-tags.ts
```

迁移创建表结构；种子脚本创建管理员；最后一步建立系统知识点库。已有生产数据库的升级请使用[部署与升级](Deployment)中的流程，先备份，再运行正式迁移。

## 启动与首次登录

```bash
npm run dev
```

全新数据库没有管理员。服务启动后，终端会打印一次性初始化链接：

```text
尚未创建管理员。请打开以下初始化链接设置管理员账号（仅可使用一次）：http://localhost:3000/initialize?token=…
```

打开链接，设置管理员的名称、邮箱和密码（至少 6 位，不能是旧的默认密码 `123456`），提交后自动登录并进入安装向导：配置 AI 渠道、创建第一个错题本，两步都可跳过。令牌同时保存在 `config/setup-token`，创建管理员后删除；没有管理员时重启服务会再次打印链接。向导可在「设置 → 用户管理」中重新运行；已有错题本的实例升级后不会自动弹出。

从旧版本升级的实例保留原有账户；仍使用旧默认管理员 `admin@localhost` 和默认密码登录时，会被要求先修改密码。

## 完成第一道错题

1. 在管理员的 AI 设置中选择服务商、填写参数并测试连接。
2. 创建错题本，选择学段和学科；二者创建后不可修改。
3. 上传题目图片或手动输入文字，核对识别结果后保存。
4. 在题目详情检查答案、解析、知识点和难度，再尝试举一反三。

![拍照上传、文字录入和直接录入入口](https://raw.githubusercontent.com/margrop/wrong-notebook/70b66950931f6f723083e3726fbc97f2f65d2ea8/doc/screenshots/upload.png)

## 安装到手机主屏幕

- iPhone / iPad：在 Safari 中打开应用，选择“分享 → 添加到主屏幕”。
- Android：在 Chrome 菜单中选择“添加到主屏幕”或“安装应用”；也可以从 [Releases](https://github.com/margrop/wrong-notebook/releases) 安装安卓 App：单机版内置服务端，无需部署服务器，手机选 `WrongNotebook-Android-Phone-<版本>.apk`，平板选 `WrongNotebook-Android-Tablet-<版本>.apk`；已有服务器时可安装客户端版 `WrongNotebook-Android-Client-Phone/Tablet-<版本>.apk`，首次打开时填写服务器地址。

PWA 提供主屏幕入口，平板可横屏使用；通过 HTTPS 访问时会缓存页面脚本和图标，断网时显示离线提示页，数据不做离线缓存。AI 识别等功能仍需要服务端和 AI 服务可用。截图还取决于浏览器是否支持屏幕共享，并要求安全上下文，详见[常见问题](FAQ)。

完整环境变量示例见 [`.env.example`](https://github.com/margrop/wrong-notebook/blob/main/.env.example)。

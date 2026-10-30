# 部署与升级

官方镜像为 `ghcr.io/margrop/wrong-notebook`，支持 `linux/amd64` 和 `linux/arm64`。上游 `ghcr.io/wttwins/wrong-notebook` 镜像不包含本仓库新增的功能。

## 选择镜像版本

| 标签 | 用途 |
| --- | --- |
| `2026.10.20` 等精确版本 | 固定版本，便于升级和回退 |
| `2026.10` 等月份标签 | 跟随该月份的正式发布 |
| `latest` | 跟随最新正式发布 |

可用版本和发布说明见 [Releases](https://github.com/margrop/wrong-notebook/releases)。下例使用已发布的 `2026.10.20`，部署时可替换为所需的正式版本。

## Docker Compose 部署

创建部署目录：

```bash
mkdir -p wrong-notebook/data wrong-notebook/config
cd wrong-notebook
openssl rand -base64 32
```

将生成的密钥和实际访问地址写入当前目录的 `.env`：

```dotenv
NEXTAUTH_SECRET=替换为生成的密钥
NEXTAUTH_URL=http://localhost:3000
```

从其他设备访问时，把 `NEXTAUTH_URL` 改为实际访问应用的完整 URL。

新建 `docker-compose.yml`：

```yaml
services:
  wrong-notebook:
    image: ghcr.io/margrop/wrong-notebook:2026.10.20
    container_name: wrong-notebook
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:?请在 .env 中设置 NEXTAUTH_SECRET}
      NEXTAUTH_URL: ${NEXTAUTH_URL:-http://localhost:3000}
      PRESERVE_EXISTING_DATA: "true"
    volumes:
      - ./data:/app/data
      - ./config:/app/config
```

启动并检查服务：

```bash
docker compose up -d
docker compose ps
curl --fail http://localhost:3000/api/health
```

全新部署没有默认账号，启动日志中会打印一次性初始化链接：

```bash
docker compose logs wrong-notebook | grep initialize
```

在浏览器中打开该链接（链接主机与 `NEXTAUTH_URL` 一致），设置管理员邮箱和密码后进入安装向导。链接只能使用一次；令牌也保存在 `config/setup-token`。

健康接口正常时返回 `status: "ok"`，并包含 `version`、`revision`。接口会执行数据库查询，但不会测试 AI；还需登录后在 AI 设置中测试连接，再识别一道实际题目。

新安装的默认账户见[快速开始](Quick-Start)。

## 持久化目录

| 容器目录 | 内容 | 处理方式 |
| --- | --- | --- |
| `/app/data` | SQLite 数据库及初始化标记 | 持久挂载并定期备份 |
| `/app/config` | 网页保存的 AI 配置、提示词和全局设置 | 持久挂载，备份中包含敏感凭据 |
| `/app/certs` | 使用内置 HTTPS 时的证书 | 按需挂载并备份 |

镜像默认设置 `PRESERVE_EXISTING_DATA=true`。检测到已有数据库时，启动流程执行正式迁移，跳过管理员播种和系统标签重建，以保留已有账户、标签及关联。

## HTTPS 与反向代理

域名访问建议使用受浏览器信任的 HTTPS 证书。可以通过反向代理将 HTTPS 请求转到应用的 HTTP 端口，并将 `NEXTAUTH_URL` 设置为外部 HTTPS 地址。

应用也提供内置 HTTPS，参考仓库中的 [`docker-compose.https.yml`](https://github.com/margrop/wrong-notebook/blob/main/docker-compose.https.yml)：

- 设置 `HTTPS_ENABLED=true`、`CERT_DOMAIN` 和正确的 `NEXTAUTH_URL`。
- 映射容器 `443` 端口，将证书目录挂载到 `/app/certs`。
- 自定义证书文件名为 `cert.pem` 和 `key.pem`；缺失时启动脚本会尝试生成自签名证书。

自签名证书需要客户端正确配置并信任。HTTPS 是屏幕截图的必要条件之一，移动浏览器仍可能不支持 `getDisplayMedia()`。更多说明见 [HTTPS 配置文档](https://github.com/margrop/wrong-notebook/blob/main/doc/HTTPS_SETUP.md)。

## 升级

1. 记录当前镜像版本，按[整站备份流程](Backup-and-Restore)备份 `data/`、`config/` 和部署配置。
2. 修改 Compose 中的镜像版本，保持挂载目录和会话密钥。
3. 执行：

   ```bash
   docker compose pull
   docker compose up -d
   docker compose logs --tail=100 wrong-notebook
   curl --fail http://localhost:3000/api/health
   ```

4. 核对运行版本，并登录确认原账户、错题、标签和试卷仍可使用。

升级后若需回退，先停服务，按备份恢复与旧版本匹配的数据和配置，再启动旧镜像。数据库已经迁移时，仅切回旧镜像未必兼容。

## 从源码构建镜像

```bash
git clone https://github.com/margrop/wrong-notebook.git
cd wrong-notebook
docker build -t wrong-notebook:local .
```

Dockerfile 在镜像内执行 Vitest、脚本语法检查和生产构建，并初始化新安装使用的数据库。将 Compose 的 `image` 改为 `wrong-notebook:local` 后，可沿用上述挂载方式运行。

## 安装包（不使用 Docker）

每个版本的 [Releases](https://github.com/margrop/wrong-notebook/releases) 还提供以下安装包，运行与镜像相同的服务端，启动时同样自动执行数据库迁移并保留已有数据：

| 平台 | 安装方式 | 默认数据目录 |
| --- | --- | --- |
| npm | `npm install -g wrong-notebook`，再运行 `wrong-notebook --port 3000`（需要 Node.js 22.15 或更新版本） | `~/.wrong-notebook` |
| Windows | `WrongNotebook-Win-Setup-<版本>-x64.exe` 或免安装的 `Portable` 版 | `%APPDATA%\WrongNotebook\data` |
| macOS | `WrongNotebook-Mac-<版本>-arm64.dmg`（Apple 芯片）或 `-x64.dmg`（Intel） | `~/Library/Application Support/WrongNotebook/data` |
| Linux | `WrongNotebook-Linux-<版本>-<架构>.AppImage` 或 `.deb` | `~/.config/WrongNotebook/data` |
| 飞牛OS | 先在应用中心安装 Node.js v24，再手动安装 `WrongNotebook-FnOS-<版本>-x86.fpk` 或 `-arm.fpk`，在安装向导中设置管理员邮箱和密码 | 应用数据目录 `@appdata/wrongnotebook` |
| 安卓手机 / 平板（单机版） | 安装 `WrongNotebook-Android-Phone-<版本>.apk` 或 `WrongNotebook-Android-Tablet-<版本>.apk` | App 私有目录，卸载时删除 |
| 安卓手机 / 平板（客户端） | 安装 `WrongNotebook-Android-Client-Phone-<版本>.apk` 或 `-Client-Tablet-<版本>.apk`，首次打开填写服务器地址 | 不保存数据，连接已部署的服务器 |

Windows 安装包当前仍未签名，项目正在申请 SignPath Foundation。签名范围、职责和状态见 [Code signing policy](https://github.com/margrop/wrong-notebook/blob/main/doc/CODE_SIGNING.md)，数据处理见[隐私说明](https://github.com/margrop/wrong-notebook/blob/main/doc/PRIVACY.md)。维护者可在获批后按 [Windows 签名配置](https://github.com/margrop/wrong-notebook/blob/main/doc/WINDOWS_SIGNING.md)启用签名。

桌面版只监听本机，默认端口 39300；飞牛OS 版监听 39300 端口，局域网内可访问。数据库、AI 配置和会话密钥都在数据目录中，备份时整体复制该目录。

桌面安装包未签名。macOS 提示「已损坏」或无法打开时，先把应用拖入「应用程序」，再在终端执行以下命令，移除隔离属性并在本机重新自签名，然后打开应用：

```bash
xattr -cr /Applications/WrongNotebook.app
codesign --force --deep --sign - /Applications/WrongNotebook.app
```

安卓单机版在手机上运行服务端，无需另行部署，需要 Android 8.0 及以上的 64 位 ARM 设备；安卓客户端版只是连接服务器的外壳，需要先用上面任一方式部署服务端。详细说明见 [INSTALL_PACKAGES.md](https://github.com/margrop/wrong-notebook/blob/main/doc/INSTALL_PACKAGES.md)。

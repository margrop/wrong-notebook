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

内网合规或演示环境不希望发送任何匿名统计时，在 `.env` 中加入 `TELEMETRY_DISABLED=true`，强制关闭本地记录、错误回报与外发；也可以保留开启，在“设置 → 用户管理 → 隐私与遥测”中按需调整，见[设置与用户管理](Settings-and-Users#隐私与遥测)。

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

## Unraid（Docker 界面）

Unraid 通过 Docker 页管理容器，不需要 `docker-compose.yml`。应用数据默认放在 `/mnt/user/appdata/wrong-notebook`。

在 Docker 页点击 **Add Container**，切换到高级视图后填写：

| 字段 | 值 |
| --- | --- |
| Repository | `ghcr.io/margrop/wrong-notebook:<精确版本>`（推荐，如 `2026.11.6`）或 `latest` |
| Network | bridge |
| Port | 主机端口（如 `3000`） → 容器 `3000` |
| Path 1（主机 → 容器） | `/mnt/user/appdata/wrong-notebook/data` → `/app/data` |
| Path 2（主机 → 容器） | `/mnt/user/appdata/wrong-notebook/config` → `/app/config` |
| Variable 1 | `NEXTAUTH_SECRET` = `openssl rand -base64 32` 的输出 |
| Variable 2 | `NEXTAUTH_URL` = `http://你的IP或域名:3000` |
| Variable 3 | `PRESERVE_EXISTING_DATA` = `true` |
| Restart policy | `unless-stopped` |

主机目录不存在时 Unraid 会自动创建。点击 **Apply** 启动，然后检查：

```bash
docker logs wrong-notebook 2>&1 | grep initialize
curl --fail http://localhost:3000/api/health
```

首次启动没有默认账号：打开日志中的一次性初始化链接（令牌也在 `/mnt/user/appdata/wrong-notebook/config/setup-token`），设置管理员邮箱和密码，再进入安装向导。`NEXTAUTH_URL` 的主机要与实际访问地址一致。

### 升级

1. 记录当前 Repository 标签，按[数据备份与恢复](Backup-and-Restore)停止容器并归档整个 appdata 目录；也可以在 Unraid 的 Appdata Backup 插件中把该目录加入备份。
2. 在 Docker 页编辑容器：
   - 使用 `latest`：点击 **Force update** 重新拉取并重建。
   - 使用精确版本：把 Repository 标签改为新版本后点击 **Apply**（或 **Force update**）。
3. 保持 `data`、`config` 的映射和 `NEXTAUTH_SECRET` 不变；启动时会自动执行数据库迁移并保留已有账户、标签、题目和试卷。
4. 查看容器日志与 `/api/health`，登录核对运行版本和数据。

**回退**：先停止容器，恢复升级前的 `data/`、`config/`，再把 Repository 标签改回旧版本并启动。数据库已经迁移时，只切回旧镜像未必兼容。

## 群晖 DSM（Container Manager）

DSM 7.2 及以上使用 Container Manager；旧版 DSM 的 Docker 套件操作类似。建议数据目录为 `/volume1/docker/wrong-notebook`，其他存储卷路径相应替换。

**套件安装（推荐）**：先安装 Container Manager，再在套件中心 →「手动安装」选择 `WrongNotebook-Synology-<版本>-x86_64.spk`（Intel / AMD 机型）或 `-arm64.spk`（64 位 ARM 机型）。需要 DSM 7.2.1 及以上。套件在 Container Manager 中创建项目 `wrong-notebook`，加载套件内置的同版本镜像（安装时无需联网拉取），把主机端口 `39300` 映射到容器 `3000`，数据放在套件数据目录 `/volumeN/@appdata/wrongnotebook`；从 DSM 主菜单的「错题本」图标或 `http://NAS地址:39300` 进入应用，首次启动按页面提示设置管理员。升级套件会按新镜像重建容器并保留数据，卸载套件保留数据目录。

以下是手动容器方式：

1. **准备目录**：在 File Station 中创建 `docker/wrong-notebook/data` 与 `config`，或通过 SSH 执行：

   ```bash
   mkdir -p /volume1/docker/wrong-notebook/data /volume1/docker/wrong-notebook/config
   ```

2. **拉取映像**：Container Manager → **映像** → 新增，从注册表搜索 `margrop/wrong-notebook`，或从 URL 添加 `ghcr.io/margrop/wrong-notebook:<精确版本>`（如 `2026.11.6`）。
3. **创建容器**：**容器** → 新增 → 从映像创建，选择刚拉取的映像：

   | 字段 | 值 |
   | --- | --- |
   | 容器名称 | `wrong-notebook` |
   | 端口 | 本地 `3000` → 容器 `3000` |
   | 卷 1 | `/volume1/docker/wrong-notebook/data` → `/app/data`（读写） |
   | 卷 2 | `/volume1/docker/wrong-notebook/config` → `/app/config`（读写） |
   | 环境变量 | `NEXTAUTH_SECRET`、`NEXTAUTH_URL=http://你的IP或域名:3000`、`PRESERVE_EXISTING_DATA=true` |
   | 自动重启 | 开启 |

4. **启动与初始化**：启动后在容器详情 → 日志中查找 `initialize` 链接（令牌也在 `/volume1/docker/wrong-notebook/config/setup-token`），设置管理员邮箱和密码。检查 `curl --fail http://localhost:3000/api/health`，正常时返回 `status: "ok"`、`version` 和 `revision`。
5. **升级**：按[数据备份与恢复](Backup-and-Restore)停止容器并归档整个目录，或在 Hyper Backup 中把 `/volume1/docker/wrong-notebook` 加入备份任务。然后在映像页拉取新版本标签，停止旧容器，用新映像和相同的卷、端口、环境变量重建；启动时自动执行数据库迁移，保留已有账户、标签、题目和试卷。使用 `latest` 时拉取最新映像后重建。
6. **回退**：数据库已经迁移时，只切回旧镜像未必兼容。先停止容器，恢复升级前的 `data/`、`config/`，再用旧版本映像重建。

域名访问可在 DSM 的 **控制面板 → 登录门户 → 高级 → 反向代理** 中把 HTTPS 请求转到容器端口，并把 `NEXTAUTH_URL` 设为外部地址。

## 威联通 QTS（Container Station）

使用 Container Station。建议数据目录为 `/share/Container/wrong-notebook`；Container Station 的默认共享文件夹是 `Container`，自定义存储位置时相应替换。

**套件安装（推荐）**：先安装 Container Station，再在 App Center →「手动安装」选择 `WrongNotebook-QNAP-<版本>-x86_64.qpkg`（Intel / AMD 机型）或 `-arm64.qpkg`（64 位 ARM 机型）。套件加载内置的同版本镜像（无需联网拉取）、生成 `NEXTAUTH_SECRET`、把主机端口 `39300` 映射到容器 `3000`，数据放在 `/share/Container/wrong-notebook/{data,config}`；App Center 的打开链接进入应用，首次启动按页面提示设置管理员。升级套件会按新镜像重建容器并保留数据，卸载套件保留数据目录。

以下是手动容器方式：

1. **准备目录**：通过 File Station 或 SSH 创建：

   ```bash
   mkdir -p /share/Container/wrong-notebook/data /share/Container/wrong-notebook/config
   ```

2. **拉取映像**：在 Container Station 的映像页拉取 `ghcr.io/margrop/wrong-notebook:<精确版本>`；也可以在 SSH 中执行 `docker pull ghcr.io/margrop/wrong-notebook:<精确版本>`。使用 **应用程序**（Compose）方式时，可在 YAML 的 `image` 中直接指定。
3. **创建容器**：**容器** → 创建，选择已拉取的映像：

   | 字段 | 值 |
   | --- | --- |
   | 容器名称 | `wrong-notebook` |
   | 端口 | 主机 `3000` → 容器 `3000` |
   | 卷 1 | `/share/Container/wrong-notebook/data` → `/app/data` |
   | 卷 2 | `/share/Container/wrong-notebook/config` → `/app/config` |
   | 环境变量 | `NEXTAUTH_SECRET`、`NEXTAUTH_URL=http://你的IP或域名:3000`、`PRESERVE_EXISTING_DATA=true` |
   | 重启策略 | `unless-stopped` |

4. **启动与初始化**：启动后在容器日志中查找 `initialize` 链接（令牌也在 `/share/Container/wrong-notebook/config/setup-token`），设置管理员邮箱和密码。检查 `curl --fail http://localhost:3000/api/health`。
5. **升级**：按[数据备份与恢复](Backup-and-Restore)停止容器并归档数据目录，或在 Hybrid Backup Sync 中把 `/share/Container/wrong-notebook` 加入备份任务。拉取新版本映像后，用相同的卷、端口、环境变量重建容器；使用 **应用程序** 时，修改 YAML 中的映像标签后重新应用。启动时自动执行数据库迁移。
6. **回退**：数据库已经迁移时，只切回旧镜像未必兼容。先停止容器，恢复升级前的 `data/`、`config/`，再用旧版本映像重建。



## 持久化目录

| 容器目录 | 内容 | 处理方式 |
| --- | --- | --- |
| `/app/data` | SQLite 数据库及初始化标记 | 持久挂载并定期备份 |
| `/app/config` | 网页保存的 AI 配置、提示词和全局设置 | 持久挂载，备份中包含敏感凭据 |
| `/app/certs` | 使用内置 HTTPS 时的证书 | 按需挂载并备份 |

镜像默认设置 `PRESERVE_EXISTING_DATA=true`。检测到已有数据库时，启动流程执行正式迁移，跳过管理员播种和系统标签重建，以保留已有账户、标签及关联。

## HTTPS 与反向代理

域名访问建议使用受浏览器信任的 HTTPS 证书。可以通过反向代理将 HTTPS 请求转到应用的 HTTP 端口，并将 `NEXTAUTH_URL` 设置为外部 HTTPS 地址。

反向代理请转发 `X-Real-IP` 或 `X-Forwarded-For`，登录失败次数按来源 IP 统计。应用默认返回 `X-Frame-Options: SAMEORIGIN` 等安全头，不能被其他域名的页面用 iframe 嵌入；需要启用 HSTS 时请在反向代理上配置。

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

Windows 安装包当前仍未签名；项目已通过 SignPath Foundation 审核，正在用测试证书接入，取得生产证书后启用签名。签名范围、职责和状态见 [Code signing policy](https://github.com/margrop/wrong-notebook/blob/main/doc/CODE_SIGNING.md)，数据处理见[隐私说明](https://github.com/margrop/wrong-notebook/blob/main/doc/PRIVACY.md)。维护者可按 [Windows 签名配置](https://github.com/margrop/wrong-notebook/blob/main/doc/WINDOWS_SIGNING.md)启用签名。

桌面版只监听本机，默认端口 39300；飞牛OS 版监听 39300 端口，局域网内可访问。数据库、AI 配置和会话密钥都在数据目录中，备份时整体复制该目录。

桌面安装包尚无受信任的签名：Windows 安装包未签名；macOS 安装包只有本地自签名（ad-hoc），未经 Apple 公证。macOS 首次打开被拦截时，先把应用拖入「应用程序」，到「系统设置 → 隐私与安全性」点击「仍要打开」；若仍提示「已损坏」（旧版本安装包常见），在终端执行以下命令，移除隔离属性并在本机重新签名，然后打开应用：

```bash
xattr -cr /Applications/WrongNotebook.app
codesign --force --deep --sign - /Applications/WrongNotebook.app
```

安卓单机版在手机上运行服务端，无需另行部署，需要 Android 8.0 及以上的 64 位 ARM 设备；两个安卓版本都需要 Android System WebView 111 及以上；安卓客户端版只是连接服务器的外壳，需要先用上面任一方式部署服务端。详细说明见 [INSTALL_PACKAGES.md](https://github.com/margrop/wrong-notebook/blob/main/doc/INSTALL_PACKAGES.md)。

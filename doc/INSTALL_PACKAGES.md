# 安装包

除 Docker 镜像外，每个版本还提供以下安装包，均可在 [GitHub Releases](https://github.com/margrop/wrong-notebook/releases) 下载（npm 包发布到 npm 仓库）。

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| npm | `npm install -g wrong-notebook` | 需要 Node.js 22.15 及以上，适合服务器或已有 Node 环境 |
| Windows | `WrongNotebook-Win-Setup-<版本>-x64.exe` / `WrongNotebook-Win-Portable-<版本>-x64.exe` | 安装版 / 免安装版 |
| macOS | `WrongNotebook-Mac-<版本>-arm64.dmg`（Apple 芯片）/ `-x64.dmg`（Intel），另有同名 `.zip` | 未签名，首次打开需右键选择「打开」 |
| Linux | `WrongNotebook-Linux-<版本>-<架构>.AppImage` / `.deb` | x86_64 与 arm64 |
| 飞牛OS | `WrongNotebook-FnOS-<版本>-x86.fpk` / `-arm.fpk` | 在应用中心手动安装，依赖应用中心的 Node.js v24 |
| 安卓手机 | `WrongNotebook-Android-Phone-<版本>.apk` | 单机版，内置服务端，无需部署服务器；锁定竖屏 |
| 安卓平板 | `WrongNotebook-Android-Tablet-<版本>.apk` | 单机版，内置服务端，无需部署服务器；横竖屏自动旋转 |
| 安卓手机 / 平板（客户端） | `WrongNotebook-Android-Client-Phone-<版本>.apk` / `-Client-Tablet-<版本>.apk` | 客户端版，连接已部署的服务器 |

校验和见 Release 中的 `SHA256SUMS.txt`。

除安卓客户端版外，所有安装包（含安卓单机版）运行同一个服务端（Next.js standalone 构建）和启动器 `packaging/runtime/launcher.js`，行为与 Docker 镜像一致：

- 首次启动复制预置数据库（含默认管理员和系统标签），默认管理员为 `admin@localhost` / `123456`，首次登录会强制修改密码。
- 每次启动执行 `prisma migrate deploy`，只做增量迁移，升级保留已有数据。
- 数据库、`config/app-config.json` 和自动生成的 NextAuth 密钥都在数据目录，安装目录可以只读。

## 各平台说明

### npm

```bash
npm install -g wrong-notebook
wrong-notebook --port 3000 --host 0.0.0.0 --data-dir ~/.wrong-notebook
```

- 数据目录默认 `~/.wrong-notebook`，也可用环境变量 `WRONG_NOTEBOOK_HOME`。
- 安装时由 postinstall 按本机平台生成 Prisma Client 并下载引擎。国内网络可设置 `PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma`。
- 需要后台常驻时可交给 systemd、pm2 等进程管理工具。

### Windows / macOS / Linux 桌面版

桌面版基于 Electron，内置服务端，打开即用：

- 服务只监听 `127.0.0.1`，默认端口 39300，被占用时自动顺延。
- 数据目录：Windows `%APPDATA%\WrongNotebook\data`，macOS `~/Library/Application Support/WrongNotebook/data`，Linux `~/.config/WrongNotebook/data`。服务日志在数据目录的 `logs/server.log`。
- 卸载不会删除数据目录。
- 安装包未签名：Windows 可能出现 SmartScreen 提示，选择「仍要运行」；macOS 提示「已损坏」或无法打开时，执行 `xattr -cr /Applications/WrongNotebook.app` 和 `codesign --force --deep --sign - /Applications/WrongNotebook.app`（移除隔离属性并在本机重新自签名）。
- Linux 的 Prisma 引擎需要 OpenSSL 3（Ubuntu 22.04、Debian 12 及更新版本）。

### 飞牛OS

1. 在应用中心安装 Node.js v24。
2. 应用中心 →「手动安装」，选择与设备架构对应的 `.fpk`。
3. 安装后从桌面图标打开，服务端口 39300，局域网内其他设备也可通过 `http://<NAS 地址>:39300` 访问。

数据保存在应用数据目录（`@appdata/wrongnotebook`），日志为其中的 `wrong-notebook.log`。

### 安卓手机 / 平板

安卓 App（`packaging/android`）分两种，各有手机版（`Phone`，锁定竖屏）和平板版（`Tablet`，横竖屏自动旋转）。安装时需允许「安装未知来源应用」。

| | 单机版 `WrongNotebook-Android-<Phone\|Tablet>-<版本>.apk` | 客户端版 `WrongNotebook-Android-Client-<Phone\|Tablet>-<版本>.apk` |
| --- | --- | --- |
| 服务端 | 内置，在手机上运行 | 需先用 Docker 或其他安装包部署 |
| 数据 | 保存在本机，卸载 App 时删除 | 保存在服务器 |
| 安装包大小 | 约 75MB | 约 2MB |
| 系统要求 | Android 8.0 及以上，64 位 ARM（arm64-v8a） | Android 7.0 及以上 |
| 包名 | `com.margrop.wrongnotebook.standalone` | `com.margrop.wrongnotebook` |

两种 App 包名不同，可以同时安装；同一种的手机版和平板版包名相同，可以互相覆盖安装。

#### 单机版

APK 内置 Node.js、Prisma 引擎和与其他安装包相同的服务端：

1. 打开 App 时在本机启动服务端（只监听 `127.0.0.1`，其他设备无法访问）。首次启动或升级后需要先解压服务端并初始化数据库，会稍慢一些。
2. 首次使用以默认管理员 `admin@localhost` / `123456` 登录，安装向导会引导修改默认密码（必须）、配置 AI 渠道并创建第一个错题本。
3. 数据库、配置和日志保存在 App 私有目录（`files/data`），卸载 App 会删除全部数据。数据中含 API Key 等敏感信息，两种 App 都不参与系统备份（`allowBackup=false`），卸载或换机前请在「设置」中导出备份，到新设备上再导入。

App 切到后台后系统可能结束服务端进程，回到前台时会自动重新启动。

#### 客户端版

客户端版是原生 WebView 外壳，不内置服务端：

1. 首次打开填写服务器地址，如 `http://192.168.1.10:3000`，省略协议时默认 `http://`。客户端会请求 `/api/health` 确认是错题本服务器；检查失败（如自签名证书）时可选择仍然使用。
2. 之后在「设置 → 关于」中可查看当前服务器并更换；连接失败的页面上也有「更换服务器」按钮。

局域网部署通常使用 HTTP，客户端允许明文连接。使用自签名证书的 HTTPS 时，首次访问会提示证书不受信任，确认后在本次运行中信任；也可以在系统中安装该证书的 CA，之后不再提示。

#### 原生能力

两种 App 都补齐了 WebView 默认不具备的能力：

- 上传图片时可选择拍照或从相册、文件中选取。
- 导出备份、下载试卷等文件通过系统「另存为」保存。
- 打印预览中的「打印」调用系统打印，可另存为 PDF。
- 错题本以外的链接（项目主页、AI 服务商控制台等）用系统浏览器打开。

网页可以通过 User-Agent 中的 `WrongNotebookAndroid/<版本> (phone|tablet)` 识别 App，App 向网页提供的接口见 `src/lib/android-app.ts`。

## 本地构建

需要 Node.js 22.15 及以上。Prisma 引擎与构建机平台一致，桌面版和飞牛OS 包须在目标平台（及架构）上构建。

```bash
npm ci
node scripts/package/build.mjs bundle                 # 构建通用服务端包 dist/bundle
node scripts/package/build.mjs npm                    # dist/wrong-notebook-<版本>.tgz
node scripts/package/build.mjs desktop --mac --arm64  # 参数原样传给 electron-builder
node scripts/package/build.mjs fnos --arch x86        # 需要 PATH 中有 fnpack
bash scripts/package/build-android-prisma-engines.sh dist/android-prisma-engines  # 安卓单机版需要的 Prisma 引擎
node scripts/package/build.mjs android                # 单机版和客户端版 APK，可加 --mode standalone|client、--flavor phone|tablet
```

桌面版使用 Electron 45（内置 Node.js 24）和 electron-builder 26，服务端由 Electron 自带的 Node 运行。electron-builder 26 复制 `extraResources` 时总会跳过来源目录根层的 `node_modules`，因此 `packaging/desktop/package.json` 把 `server/node_modules` 单独列为一项；打包后 `build.mjs` 会检查 Prisma Client 等关键文件是否进入安装包。

安卓 APK 构建需要 JDK 17、Android SDK（`ANDROID_HOME`，compileSdk 35、build-tools 35.0.0）和 Gradle 8.11（PATH 中的 `gradle`，或用环境变量 `GRADLE` 指定）。客户端版不依赖 `bundle`；单机版还需要：

- `dist/bundle`：与其他安装包相同的服务端。
- 安卓 Prisma 引擎：Prisma 不提供安卓版本，`build-android-prisma-engines.sh` 按项目安装的 Prisma 版本下载对应提交的 prisma-engines 源码，用 Android NDK（`ANDROID_NDK_HOME`）和 rustup 交叉编译查询引擎与迁移引擎，约需 15–30 分钟。输出目录默认 `dist/android-prisma-engines`，可用 `ANDROID_PRISMA_ENGINES_DIR` 指定。
- `patchelf`（可用 `PATCHELF` 指定路径）和 `zip`。

单机版内置的 Node.js 取自 [Termux](https://termux.dev) 软件源的 `nodejs-lts` 及其依赖库（构建时按软件源索引校验 SHA256，可用 `TERMUX_MIRROR` 指定镜像）。安卓只允许执行 `nativeLibraryDir` 中的程序，因此 Node.js、依赖库和引擎都以 `lib*.so` 的形式放进 `jniLibs/arm64-v8a`，由 `scripts/package/android-runtime.mjs` 改名并用 patchelf 改写依赖；服务端打包为 `assets/server.zip`，首次启动时解压。各组件的许可证随 APK 放在 `assets/licenses/`。

versionCode 由版本号换算（`scripts/package/android-version.mjs`）：预览版 `2026.10.22-3` 为 `2026102203`，正式版 `2026.10.22` 为 `2026102299`，保证升级时递增。

签名密钥通过环境变量传入：`ANDROID_KEYSTORE_FILE`（密钥库路径）、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`（缺省与密钥库密码相同）。未提供时使用调试签名，只能用于测试。

- 版本号依次取 `--version`、环境变量 `PACKAGE_VERSION`、`package.json`。
- `bundle` 会构建 Next.js；只改了打包脚本时可加 `--skip-build` 复用已有的 `.next`。
- 产物全部输出到 `dist/`（已加入 `.gitignore`）。打包时会移除 standalone 带入的 `.env`、`config/` 和数据库文件，避免把本机密钥打进安装包。

## 发布

推送 `v*` 标签后，`.github/workflows/packages.yml` 在各平台 Runner 上构建全部安装包并上传到对应的 GitHub Release；也可以在 Actions 页面手动运行，只生成构建产物。安卓 Prisma 引擎按引擎提交缓存，只有升级 Prisma 或修改编译脚本后才需要重新编译。

安卓 APK 必须一直使用同一个密钥签名，否则用户无法覆盖安装升级。需要在仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 说明 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 密钥库文件的 Base64（`base64 -i release.jks`） |
| `ANDROID_KEYSTORE_PASSWORD` | 密钥库密码 |
| `ANDROID_KEY_ALIAS` | 密钥别名 |
| `ANDROID_KEY_PASSWORD` | 密钥密码，与密钥库密码相同时可不配置 |

推送标签时未配置这些 Secret，安卓构建会失败，Release 也不会上传安装包；手动运行时使用调试签名。密钥库须妥善备份，丢失后已安装的用户只能卸载重装。

npm 使用 [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)（OIDC）发布，不需要 `NPM_TOKEN`。npmjs.com 上 `wrong-notebook` 包的 Settings → Trusted Publisher 已登记 GitHub Actions：`margrop/wrong-notebook`、工作流 `packages.yml`；重命名该工作流文件时需同步修改登记。带 `-` 的预发布标签发布到 npm 的 `next` 标签。npm 发布在独立的 Job 中，失败不影响安装包上传到 Release。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `scripts/package/build.mjs` | 构建脚本 |
| `packaging/runtime/launcher.js` | 各安装包共用的启动器 |
| `packaging/npm/` | npm 命令行入口与 README |
| `packaging/desktop/` | Electron 桌面壳与 electron-builder 配置 |
| `packaging/fnos/` | 飞牛OS manifest、生命周期脚本、安装向导和图标 |
| `packaging/android/` | 安卓 App Gradle 工程（单机版 / 客户端版 × 手机版 / 平板版） |
| `scripts/package/android-runtime.mjs` | 组装安卓单机版内置的 Node.js、Prisma 引擎和服务端 |
| `scripts/package/build-android-prisma-engines.sh` | 交叉编译安卓 Prisma 引擎 |

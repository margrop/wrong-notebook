<p align="center">
  <img src="public/icons/icon.png" width="128" height="128" alt="智能错题本应用图标">
</p>

# Smart Wrong Notebook (智能错题本)

**简体中文** | [English](README.en.md)

[![GitHub downloads](https://img.shields.io/github/downloads/margrop/wrong-notebook/total?label=downloads&logo=github)](https://github.com/margrop/wrong-notebook/releases) [![npm downloads](https://img.shields.io/npm/d18m/wrong-notebook?label=npm%20downloads&logo=npm)](https://www.npmjs.com/package/wrong-notebook) [![GitHub stars](https://img.shields.io/github/stars/margrop/wrong-notebook?logo=github)](https://github.com/margrop/wrong-notebook/stargazers) [![GitHub forks](https://img.shields.io/github/forks/margrop/wrong-notebook?logo=github)](https://github.com/margrop/wrong-notebook/forks)

[![桌面版](https://img.shields.io/badge/%E6%A1%8C%E9%9D%A2%E7%89%88-Windows%20%7C%20macOS%20%7C%20Linux-informational)](https://github.com/margrop/wrong-notebook/releases) [![Android](https://img.shields.io/badge/Android-34A853?logo=android&logoColor=white)](https://github.com/margrop/wrong-notebook/releases) [![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://github.com/margrop/wrong-notebook/pkgs/container/wrong-notebook) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/wrong-notebook) [![飞牛OS](https://img.shields.io/badge/%E9%A3%9E%E7%89%9BOS-fpk-0A84FF)](https://github.com/margrop/wrong-notebook/releases) [![Web](https://img.shields.io/badge/Web-PC%20%7C%20Mobile-orange)](https://wrong-notebook-demo.vercel.app)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Release](https://img.shields.io/github/v/release/margrop/wrong-notebook?include_prereleases)](https://github.com/margrop/wrong-notebook/releases) [![CI](https://github.com/margrop/wrong-notebook/actions/workflows/ci.yml/badge.svg)](https://github.com/margrop/wrong-notebook/actions/workflows/ci.yml) [![CodeQL](https://github.com/margrop/wrong-notebook/actions/workflows/codeql.yml/badge.svg)](https://github.com/margrop/wrong-notebook/actions/workflows/codeql.yml) [![npm](https://img.shields.io/npm/v/wrong-notebook)](https://www.npmjs.com/package/wrong-notebook)

一个基于 AI 的智能错题管理系统：拍照或输入题目后，由 AI 识别、解答、打知识点标签并评定难度，支持错题本管理、举一反三练习、组卷打印和掌握程度跟踪。

**⬇️ [下载安装包](https://blog.margrop.net/wrong-notebook-github-pages/download/)** · **🚀 [在线演示](https://wrong-notebook-demo.vercel.app)**（账号 `demo@localhost`，密码 `demo123456`） · **🌐 [项目介绍页](https://blog.margrop.net/wrong-notebook-github-pages/)** · **📖 [使用文档（Wiki）](https://github.com/margrop/wrong-notebook/wiki)**

> 演示站点为共享账号，数据对所有访客可见，请勿录入个人信息。介绍文章：[别让错题本变成抄题本：我给孩子用的 AI 错题本开源了](https://blog.margrop.net/post/wrong-notebook-ai-family-learning/) · [不用先配 API Key：接上 MiniMax 免费账号](https://blog.margrop.net/post/wrong-notebook-minimax-free-ai-review/)

## 🌟 亮点

- **🤖 AI 识题与讲解**：拍照、截图或输入文字，AI 识别题目、生成答案和解析，分析错因，打知识点标签并评定 1～5 星难度。
- **🔊 会说话的 SVG 动画讲解**：AI 把解题思路做成分步骤动画并逐步语音讲解，画面等语音读完再进入下一步。语音有两种选择：

  | 语音 | 效果 | 费用 |
  | :--- | :--- | :--- |
  | 浏览器本地语音（Web Speech） | 由设备自带的语音朗读，听起来比较生硬，音色因设备而异 | 免费 |
  | 云端 TTS 语音（MiniMax、千问、智谱 GLM-TTS、阶跃星辰、火山引擎豆包语音、火山引擎 Agent Plan、OpenAI） | 声音自然，与真人讲题无异，所有设备音色一致 | 需要付费，**建议购买 Token Plan 等套餐**，比按量付费划算；火山引擎有[免费试用额度](https://docs.volcengine.com/docs/ark/free-inference-quota?lang=zh)，可参考文档自行开通 |

- **🆓 免费账号就能用**：选择「MiniMax Code OAuth」渠道，用 MiniMax Code 账号网页登录即可使用，不需要购买 API Key，应用每天自动签到领取积分（见 [MiniMax Code OAuth](#minimax-code-oauth)）；火山引擎新用户也有[免费推理额度](#火山引擎免费试用)。
- **📚 复习闭环**：举一反三变式题自动判题、AI 评估掌握概率、艾宾浩斯间隔的今日复习、按错题组卷打印并回填结果。
- **📦 多平台安装**：Docker 镜像（amd64 / arm64）、npm、Windows、macOS、Linux、飞牛OS、安卓手机与平板（单机版或客户端），也可添加到手机主屏幕（PWA）。

> 本仓库 fork 自 [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook)，在其基础上增加了上述及下文列出的大部分功能。

## 🖼️ 功能预览

以下截图采集自实际运行的应用（2026-10-20），展示已有题目、讲解和试卷。用户名已遮挡，可点击图片查看大图。

**错题管理**：在同一页面查看题目摘要、难度星级和知识点，按年级、学期、掌握情况及 A/B 卷筛选，也可通过题目 ID 定位、比较相似度或批量打印。列表按需加载卡片数据，原图、答案和解析在详情或打印预览时读取，减少翻页时的数据传输。

![错题本中的真实题目卡片、难度星级、知识点标签与筛选入口](doc/screenshots/notebook.png)

<details>
<summary><strong>录入与偏好：拍照上传、文字录入、人工确认和可配置判重</strong></summary>

首页提供拍照上传、手动输入和直接录入入口，支持拖拽图片与剪贴板粘贴。

![首页的拍照上传、手动输入、直接录入、剪贴板粘贴和截屏入口](doc/screenshots/upload.png)

通用设置可调整导入前人工确认、SVG 动画讲解、GeoGebra 动态演示、题目判重相似度阈值和已掌握阈值。

![通用设置中的导入确认、动画讲解、GeoGebra 和判重阈值](doc/screenshots/preferences.png)

</details>

<details>
<summary><strong>题目详情：公式排版、难度星级、知识点和试题信息</strong></summary>

一道错题集中展示题干、知识点、年级学期与试卷等级，可核对原题图片，并从详情页进入举一反三。

![真实错题详情中的公式、难度星级、知识点和年级学期信息](doc/screenshots/question-detail.png)

</details>

<details>
<summary><strong>SVG 动画讲解：把解题思路变成分步骤的动态演示，并配语音讲解</strong></summary>

下图为已有六边形染色题的动画讲解，展示区域关系与递推计数过程；播放器支持暂停、拖动进度、重播和全屏。点击喇叭开启语音讲解：浏览器本地语音免费但较生硬，云端 TTS 语音自然、与真人无异（需付费，建议购买 Token Plan 等套餐）。

![六边形染色题的 SVG 动画讲解、递推计数表与播放控制](doc/screenshots/svg-animation.png)

</details>

<details>
<summary><strong>复习反馈：回看变式题、作答历史和 AI 掌握概率</strong></summary>

原题下汇总举一反三和试卷作答结果，展开记录可回看变式题与答案。AI 根据实际作答历史评估掌握概率，辅助安排后续复习。

![已有试卷变式题、先错后对的作答历史与 AI 掌握概率评估](doc/screenshots/mastery-history.png)

</details>

<details>
<summary><strong>组卷与打印：针对错题生成试卷，做完后按题回填结果</strong></summary>

生成的试卷保留来源题目 ID，并展示各次作答结果，方便回到原题跟踪复习效果。

![已生成的真实错题试卷、来源 ID 和多次作答结果](doc/screenshots/exam.png)

打印预览可选择包含答案页，支持下载 HTML、打印或通过浏览器保存为 PDF。

![真实试卷的打印预览、来源 ID、答案页开关和导出入口](doc/screenshots/exam-print.png)

</details>

<details>
<summary><strong>知识点库：按学科、年级、章节逐级浏览</strong></summary>

标准标签库按教学层级组织知识点。知识点已并入「统计」栏目：「知识点管理」页签可浏览标准标签库、增删自定义标签，「知识点统计」页签显示使用频率。

![数学知识点按四年级、几何图形、角和四边形逐级展开](doc/screenshots/knowledge-tags.png)

</details>

<details>
<summary><strong>学习统计：查看错题分布、掌握率、练习正确率和趋势</strong></summary>

错题统计展示累计错题、已掌握数量、掌握率、科目分布和月度趋势。

![真实错题数量、掌握率、科目分布和月度趋势图表](doc/screenshots/error-stats.png)

练习统计单独展示累计练习、正确率和活跃月份，并按学科、难度观察练习分布与趋势。

![真实练习次数、正确率、活跃月份与练习趋势图表](doc/screenshots/practice-stats.png)

</details>

## ✨ 主要功能

### 录入与识别

- **📷 多种录入方式**：上传图片、从剪贴板粘贴（Ctrl/⌘+V）、屏幕截图，或直接输入题目文字（支持 Markdown 和 LaTeX）；图片可裁剪（支持滚轮、双指捏合或按钮缩放图片，方便精确框选），也可在一张图上框选多道题批量导入。
- **🤖 AI 识别与解答**：识别题目文字、答案、解析、学生的错误解答和错因，判断学科，并从知识点库中选择标签。可在「设置 → 通用」中开启「导入前人工确认」，先在校对页修改再保存。
- **🔁 重复题判定**：导入时比较题干相似度，超过阈值（默认 90%，可在设置中调整）的题目不会重复导入，而是在原题下记一次做错。
- **🆔 题目 ID**：每道题有 6 位 ID，可复制，也可在错题本中输入 ID 直接打开该题；打印的错题和试卷都标有「来源 ID」，方便做完后定位原题录入结果。

### 题目内容

- **∑ LaTeX 公式**：题目、答案和解析中的公式用 KaTeX 显示，支持 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`；编辑时可在「源代码 / 预览」之间切换。检测到公式语法错误时，详情页出现「修复 LaTeX」按钮，由 AI 只修复公式写法。
- **📝 重新生成解答**：详情页「重新生成完整解答」由 AI 重新生成答案和解析（覆盖前二次确认），知识点和错因保持不变。
- **🖼️ 题目配图**：识别时由 AI 用 SVG 重绘题目配图，详情页、打印和试卷都使用 SVG 配图；拍照原图可在「查看原题图片」中核对，也可替换或补充上传。
- **⭐ 难度星级**：导入时由 AI 参考《高思学校竞赛数学导引》的星级标准评定 1~5 星（一二星为课本及校内拔高，三四星为常规奥数，五星为竞赛压轴），可手动修改；4 星及以上默认归入 B 卷。
- **🏷️ 知识点标签**：错题本创建时选择学段（小学/初中/高中）和学科（创建后不可修改），本错题本内的题目由 AI 从该学段、该学科的全部知识点中选择标签；支持自定义标签，单题或整本错题本可让 AI 重新识别知识点和难度。

### 讲解与演示

- **🎬 SVG 动画讲解**：AI 按解题思路生成分步骤的 SVG 动画，支持播放/暂停、拖动进度、重播和全屏；动画文字与界面语言一致，中英文版本分别保存，切换语言时自动显示对应版本。默认开启，可在「设置 → 通用」中关闭。
- **🔊 语音讲解**：点击播放器上的喇叭开启，画面等语音读完再进入下一步，语速可调。语音可选浏览器本地语音或云端 TTS（见[云端语音讲解](#-云端语音讲解)）；旧动画没有讲解稿时朗读画面字幕，也可点击「补充讲解稿」由 AI 只补写讲解稿，画面保持不变。
- **📐 GeoGebra 动态演示**：数学、物理题可由 AI 生成交互式 GeoGebra 图形。默认关闭，可在「设置 → 通用」中开启。
- 已生成的动画讲解和 GeoGebra 演示都可删除（需二次确认）。

### 复习与练习

- **🔄 举一反三**：基于错题生成同知识点的变式题（填空或解答题），可选难度；提交答案后自动判题（写法一致直接判对，否则由 AI 对照标准答案判定并给出依据），保存前可修改结果；每道错题暂存最近一次生成的变式题与解答，再次进入时直接显示，需要新题再点「重新生成」。
- **📈 掌握概率**：根据举一反三和试卷的作答历史，由 AI 评估每道题的已掌握概率。错题分为三种状态：没有举一反三记录的为「待复习」，有记录且掌握概率低于已掌握阈值的为「复习中」，达到阈值的为「已掌握」。阈值默认 50%，每个用户可在设置中单独调整。
- **📅 今日复习**：按 1、2、4、7、15、30 天的艾宾浩斯间隔安排每道错题的复习，做对进入下一轮间隔，做错从头开始。导航栏的「复习」页列出今天到期的错题（最早到期的在前），首页显示今日待复习数量。
- **🧾 错题试卷**：按错题本、知识点和掌握情况随机抽题，用举一反三生成一套可打印的试卷；做完后可按题录入结果，结果计入原题的作答历史。
- **🖨️ 错题打印**：筛选后打印错题，可选打印题目文字或原图、答案、解析、知识点，调节图片比例，可直接打印或保存为 PDF。

### 管理与统计

- **🔍 多维度筛选**：按掌握状态、时间范围、知识点、年级学期、试卷等级等条件筛选，支持批量操作和两题相似度比较。
- **📊 数据统计**：错题与练习的掌握率、月度趋势和学科分布。
- **⏳ 后台任务**：页面右下角的按钮可查看识别、AI 生成、动画语音生成、批量标注、组卷等耗时事务的进度；离开页面后事务仍在服务器上继续。
- **💾 数据导入导出**：在「设置」中导出或导入数据备份，包含错题本、错题、练习与作答记录、试卷、个人偏好和已合成的云端语音；账户凭据和 AI 配置不在备份中。
- **🕒 应用时区**：默认北京时间，管理员可修改，日期显示与统计都按应用时区计算，详见 [时区说明](doc/TIME_ZONE.md)。
- **🧭 安装向导**：管理员首次登录时进入向导：修改默认密码（必须）→ 配置 AI 渠道（推荐免费的 MiniMax Code）→ 创建第一个错题本，后两步可跳过；可在「设置 → 用户管理」中重新运行。已在使用的实例升级后不会自动弹出。
- **🔐 多用户与管理后台**：支持注册、登录，数据按用户隔离；新用户注册默认关闭，管理员可在「设置 → 用户管理」中开启，并可限制每人每天的 AI 使用次数、查看今日用量；管理员可在「设置 → 用户管理」进入管理后台，查看使用统计，启用/禁用或删除用户。
- **🔌 Openclaw 集成**：外部 Openclaw agent 可通过 `POST /api/openclaw/batch-upload` 批量上传题目图片，配置见[环境变量](#-环境变量)。

## 🚀 快速开始

按上手难度从易到难排列。所有方式首次登录都使用默认管理员账户：邮箱 `admin@localhost`，密码 `123456`；登录后进入安装向导，先修改默认密码（必须），再配置 AI 渠道、创建第一个错题本。

### 方式一：安装包（Windows / macOS / Linux / 飞牛OS / 安卓 / npm）

从[下载页](https://blog.margrop.net/wrong-notebook-github-pages/download/)（自动识别系统与架构）或 [Releases](https://github.com/margrop/wrong-notebook/releases) 下载对应安装包，安装后直接打开：

| 平台 | 安装包 |
| :--- | :--- |
| Windows | `WrongNotebook-Win-Setup-<版本>-x64.exe`（安装版）、`WrongNotebook-Win-Portable-<版本>-x64.exe`（免安装） |
| macOS | `WrongNotebook-Mac-<版本>-arm64.dmg`（Apple 芯片）、`WrongNotebook-Mac-<版本>-x64.dmg`（Intel） |
| Linux | `WrongNotebook-Linux-<版本>-<架构>.AppImage`、`.deb` |
| 飞牛OS | `WrongNotebook-FnOS-<版本>-x86.fpk`、`WrongNotebook-FnOS-<版本>-arm.fpk` |
| 安卓手机 / 平板（单机版） | `WrongNotebook-Android-Phone-<版本>.apk`（竖屏）、`WrongNotebook-Android-Tablet-<版本>.apk`（横竖屏自动旋转） |
| 安卓手机 / 平板（客户端） | `WrongNotebook-Android-Client-Phone-<版本>.apk`、`WrongNotebook-Android-Client-Tablet-<版本>.apk` |

也可以通过 npm 安装（Node.js 22 及以上）：

```bash
npm install -g wrong-notebook
wrong-notebook --port 3000
```

安卓单机版内置服务端，安装后直接使用，数据保存在本机（卸载 App 会删除数据；数据含 API Key，不参与系统备份，卸载或换机前请在设置中导出备份）；需要 Android 8.0 及以上的 64 位 ARM 设备。客户端版不内置服务端，首次打开时填写已部署的服务器地址（如 `http://192.168.1.10:3000`），可在「设置 → 关于」中更换服务器，需要 Android 7.0 及以上。两种 App 都支持拍照上传、导出文件和系统打印，可以同时安装。数据目录、默认账号、本地构建方法见 [INSTALL_PACKAGES.md](doc/INSTALL_PACKAGES.md)。

### 方式二：Docker 镜像部署（推荐用于服务器 / NAS）

每次发版都会把镜像发布到 GitHub Container Registry：`ghcr.io/margrop/wrong-notebook`，支持 `linux/amd64` 和 `linux/arm64`，可直接拉取，不需要源码。

| 镜像标签 | 说明 |
| --- | --- |
| `2026.10.20` 等精确版本 | 推荐，升级时可控 |
| `2026.10` | 当月最新版本 |
| `latest` | 最新正式版本 |

1. **准备目录和密钥**：

   ```bash
   mkdir -p wrong-notebook/data wrong-notebook/config
   cd wrong-notebook
   openssl rand -base64 32   # 生成的字符串用作 NEXTAUTH_SECRET
   ```

2. **启动容器**（任选一种）：

   ```bash
   docker run -d --name wrong-notebook \
     --restart always \
     -e NEXTAUTH_SECRET="上一步生成的密钥" \
     -e NEXTAUTH_URL="http://你的IP或域名:3000" \
     -p 3000:3000 \
     -v "$(pwd)/data:/app/data" \
     -v "$(pwd)/config:/app/config" \
     ghcr.io/margrop/wrong-notebook:latest
   ```

   或下载仓库中的 [`docker-compose.yml`](docker-compose.yml) 放到当前目录，修改 `NEXTAUTH_SECRET`（及 `NEXTAUTH_URL`）后执行 `docker compose up -d`。

3. **登录**：访问 `http://你的IP或域名:3000`。

4. **升级**：拉取新镜像并重建容器，数据保留在挂载目录中，启动时只执行数据库迁移。升级前建议先备份 `data/` 目录。

   ```bash
   docker compose pull && docker compose up -d
   # 使用 docker run 时：docker pull 新镜像后 docker rm -f wrong-notebook，再执行上面的 docker run
   ```

数据保存在挂载的 `data/`（SQLite 数据库）和 `config/`（网页中保存的 AI 配置、云端语音缓存等）目录。设置页「关于」和 `/api/health` 显示当前运行的版本。HTTPS 部署见 [HTTPS 配置指南](doc/HTTPS_SETUP.md) 和 `docker-compose.https.yml`。

> 上游项目的镜像 `ghcr.io/wttwins/wrong-notebook` **不包含**本仓库新增的功能，请使用 `ghcr.io/margrop/wrong-notebook`。

### 方式三：本地源码运行

1. **环境准备**：Node.js 22 及以上（推荐 24）和 npm。
2. **克隆并安装依赖**：

   ```bash
   git clone https://github.com/margrop/wrong-notebook.git
   cd wrong-notebook
   npm ci
   cp .env.example .env   # 按「环境变量」一节填写
   ```

3. **初始化数据库**：创建表结构和管理员账户，再导入系统知识点（与 Docker 构建时相同）：

   ```bash
   npx prisma migrate dev
   npx prisma db seed
   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/rebuild-system-tags.ts
   ```

4. **启动开发服务器**：`npm run dev`，访问 `http://localhost:3000`。

### 方式四：从源码构建镜像

需要修改代码或使用未发布的改动时，可以自行构建。构建过程中会在镜像内运行全部测试，并完成生产构建：

```bash
docker build -t wrong-notebook:local .

docker run -d --name wrong-notebook \
  -e NEXTAUTH_SECRET="your_secret_key" \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config:/app/config" \
  wrong-notebook:local
```

使用 `docker-compose.yml` 时，把其中的 `image` 改为 `wrong-notebook:local` 即可。

## ⚙️ AI 与语音配置

AI 配置在网页中修改，保存后立即生效，无需重启：

1. 管理员点击首页右上角的设置图标，打开「AI 设置」。
2. 选择提供商，填写 API Key、Base URL（或 Endpoint）、模型（或部署名称）。提供商下方附有官方接入文档，「API Key」「模型名称」旁附有获取说明和模型列表链接。
3. 点击「测试连接」检查文本与图片识别能力，失败时会显示服务商的原始报错；保存后配置写入 `config/app-config.json`，优先于 `.env`。
4. 同一页下方的「语音讲解」切换浏览器语音或云端语音；「提示词」页可自定义识别和举一反三的提示词模板。

AI 设置、提示词、连接测试和模型列表只对管理员开放；普通用户在「设置 → 通用」中只能修改自己的偏好。

### 支持的 AI 提供商

国产大模型官方渠道通过各家的 OpenAI 兼容接口调用，只需填写 API Key，Base URL 和模型留空时使用下表默认值；使用国际站时改填国际站地址。

| 提供商 | 推荐方式 | 默认 Base URL | 默认模型 |
| :--- | :--- | :--- | :--- |
| MiniMax | [MiniMax 开放平台](https://platform.minimax.cn) | `https://api.minimax.cn/v1`（国际站 `https://api.minimax.io/v1`） | `MiniMax-M3.1-Flash` |
| MiniMax Code OAuth | **免费账号**，网页登录，见[下文](#minimax-code-oauth) | 固定接口 | `MiniMax-M3.1-Flash` |
| 智谱 GLM | [智谱开放平台](https://open.bigmodel.cn) | `https://open.bigmodel.cn/api/paas/v4`（国际站 `https://api.z.ai/api/paas/v4`） | `glm-5.3-flash` |
| DeepSeek | [DeepSeek 开放平台](https://platform.deepseek.com) | `https://api.deepseek.com` | `deepseek-v4-flash` |
| Kimi | [Kimi 开放平台](https://platform.kimi.com) | `https://api.moonshot.cn/v1`（国际站 `https://api.moonshot.ai/v1`） | `kimi-k3.1-pro` |
| 千问 Qwen | [阿里云百炼](https://bailian.console.aliyun.com)，推荐 Token Plan | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`（按量付费 `https://dashscope.aliyuncs.com/compatible-mode/v1`） | `qwen3.8-max` |
| 阶跃星辰 StepFun | [阶跃星辰开放平台](https://platform.stepfun.com)，推荐 Step Plan | `https://api.stepfun.com/step_plan/v1`（按量付费 `https://api.stepfun.com/v1`，国际站 `https://api.stepfun.ai/v1`） | `step-5-preview` |
| 火山引擎 豆包 | [火山方舟](https://console.volcengine.com/ark)，按量付费 | `https://ark.cn-beijing.volces.com/api/v3`（国际站 `https://ark.ap-southeast.bytepluses.com/api/v3`） | `doubao-seed-2-1-lite-260915` |
| 火山引擎 Agent Plan | [Agent Plan](https://ark.volcengine.com/region:cn-beijing/docs/82379/2160841?lang=zh) 专属 Key，套餐含豆包语音合成 | `https://ark.cn-beijing.volces.com/api/plan/v3` | `ark-code-latest` |
| 火山引擎 Coding Plan | [Coding Plan](https://www.volcengine.com/docs/82379/1928261)，方舟 API Key | `https://ark.cn-beijing.volces.com/api/coding/v3`（不要改成 `/api/v3`，否则不计入套餐） | `ark-code-latest` |
| 火山引擎（免费试用） | 新用户**免费推理额度**，见[下文](#火山引擎免费试用) | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-2-1-lite-260915` |
| Anthropic 及兼容接口 | [Claude Console](https://platform.claude.com/) | `https://api.anthropic.com`（不含 `/v1`） | `claude-sonnet-5-5` |
| Azure OpenAI | Azure 门户 → OpenAI 资源 → 密钥和终结点 | 填写资源 Endpoint 和部署名称 | 部署名称 |
| OpenAI 及兼容接口 | [OpenAI Platform](https://platform.openai.com/api-keys)，可添加多个配置并切换 | `https://api.openai.com/v1` | `gpt-6.1-sol` |
| Google Gemini | [Google AI Studio](https://aistudio.google.com/apikey) | 官方地址 | `gemini-2.5-flash`（推荐 `gemini-3.8-flash`） |

> **兼容接口**：OpenAI 提供商可接入任何 OpenAI API 格式的第三方服务（如硅基流动），Anthropic 提供商可接入兼容 Messages API 的服务；把 Base URL 改为服务商地址，模型填写对应平台的完整模型 ID。推理模型返回的思考内容会被自动忽略。

#### MiniMax Code OAuth

**支持免费版 MiniMax 账号**：用 MiniMax Code 账号网页登录，不需要 API Key，也不需要开通付费套餐。

- **每天自动签到**：登录后应用每天自动签到，领取 MiniMax Code 的签到积分（连续签到奖励更多），不用手动打开客户端。
- **消耗免费积分**：识题、解析、举一反三、判题等 AI 调用消耗的是账号的免费积分额度；剩余积分随时可在设置页查看。
- **默认模型 `MiniMax-M3.1-Flash`**：已实测可用，支持图片识别；也可选 `MiniMax-M3`、`MiniMax-M2.7` 等。

使用方法：在“设置 → AI 设置”中选择 MiniMax Code OAuth，点击“网页登录”，在打开的 MiniMax 页面完成授权即可；设置页会显示登录状态、剩余积分和今天是否已自动签到。

登录凭据保存在服务端配置目录的 `minimax-code.json`（与 `app-config.json` 同目录，不随数据备份导出），Access Token 到期前自动续期。登录后服务每小时检查一次，当天（北京时间）还没签到时自动领取 MiniMax Code 的签到积分，也可以在设置页关闭自动签到或手动立即签到。该渠道使用 MiniMax Code 桌面客户端的登录方式（OAuth 设备码授权），不是官方开放接口，MiniMax 可能随时调整或限制；请遵守 MiniMax 的服务条款。

#### 火山引擎（免费试用）

注册火山引擎即可获得每个模型的[免费推理额度](https://www.volcengine.com/docs/82379/1399514)（官方文档为每个模型 50 万 tokens）。在火山方舟控制台的「开通管理」中开启「安心体验模式」后，调用只消耗免费额度，额度接近用完时自动暂停，不会产生费用。选择「火山引擎（免费试用）」渠道并填写方舟的 API Key 即可；额度用完后如需继续使用，完成实名认证并改用「火山引擎 豆包」或对应的套餐渠道。

### 🔊 云端语音讲解

动画的语音讲解默认使用浏览器本地语音（免费，但较生硬）。管理员可在「设置 → AI 设置 → 语音讲解」改用云端 TTS 语音（声音自然，与真人无异）：

| 云端语音 | API Key | 默认模型 / 音色 |
| :--- | :--- | :--- |
| MiniMax（建议 M Plan） | 与 MiniMax 渠道共用 | `speech-2.8-hd` / `male-qn-jingying` |
| 千问（建议 Token Plan） | 与千问渠道共用 | `qwen-audio-3.0-tts-plus` / `longanlufeng` |
| 智谱 GLM-TTS（建议 GLM Coding Plan） | 与智谱 GLM 渠道共用 | `glm-tts` / `xiaochen` |
| 阶跃星辰（建议 Step Plan） | 与阶跃星辰渠道共用 | `stepaudio-2.5-tts` / `qingniandaxuesheng` |
| 火山引擎豆包语音（可免费试用，建议资源包） | 单独的豆包语音 API Key | `seed-tts-2.0` / `zh_male_yangguangqingnian_uranus_bigtts` |
| 火山引擎 Agent Plan（计入套餐额度） | 与 Agent Plan 渠道共用 | `seed-tts-2.0` / `zh_male_yangguangqingnian_uranus_bigtts` |
| OpenAI | 可单独填写，留空时用当前 OpenAI 配置 | `gpt-4o-mini-tts` / `cedar` |

- 默认音色为年轻男声，自然、清晰、略带科技感，不用播音腔；模型、音色和接口地址都可修改，各字段旁附有说明文档或音色列表链接，「保存并试听」会先保存再朗读一段示例。
- 服务端把合成结果统一到约 -15 LUFS 的响度，编码为 MP3 缓存，同一段讲解只合成一次；开启语音时一次合成整个动画的讲解并登记为后台任务，已生成语音的动画打开时默认开启语音讲解，已有动画可「重新生成语音」。
- 合成的语音随数据导出、导入备份；云端语音失败时自动改用浏览器语音。合成消耗语音服务商额度，不计入每人每日的 AI 次数。

各服务商的接口说明见 Wiki 的 [AI 配置 · 云端语音讲解](doc/wiki/AI-Configuration.md#云端语音讲解)。

### 模型要求

所选模型需要满足以下条件，否则部分功能无法使用或效果较差：

| 要求 | 用到的功能 | 说明 |
| :--- | :--- | :--- |
| **支持图片输入（多模态）** | 拍照/截图识别题目、AI 重新生成配图、有原图时的重新生成解答 | 纯文本模型只能使用文字录入，识别图片会失败 |
| **能写准确的 SVG 代码** | 题目配图、举一反三和试卷新题的配图、SVG 动画讲解 | 这些「图片」都由模型输出 SVG 代码生成，**不调用图片生成模型**；模型的几何作图和 SVG 动画（SMIL）能力决定配图与动画的质量 |
| **较长的单次输出** | SVG 动画讲解（上限 16384 token）、识别题目（含配图，上限 8192 token） | 输出被截断时会用 32768 token 重试一次，模型的最大输出不足 16K 时，动画讲解容易生成失败 |
| **严格遵循输出格式** | 所有 AI 功能 | 结果按 `<answer_text>`、`<svg_animation>` 等标签或 JSON 解析，格式不符会提示「AI 返回格式异常，可能模型不兼容」 |
| **规范的 LaTeX** | 题目、答案、解析 | 公式须能被 KaTeX 显示；出现语法错误时可用详情页的「修复 LaTeX」修正 |
| **较强的数学推理** | 解答、错因分析、难度星级、掌握概率评估 | 推理（思考）模型可以使用，思考内容会被自动忽略；思考耗时较长时，管理员可在「设置 → 通用」中调大「AI 分析超时时间」 |

## 🔧 环境变量

常用环境变量如下，完整列表见下方折叠表格和 [`.env.example`](.env.example)。AI 相关配置也可以登录后在网页中填写，网页中保存的配置优先。

| 环境变量 | 说明 |
| :--- | :--- |
| `NEXTAUTH_SECRET` | Session 加密密钥，生产环境必须设置，可用 `openssl rand -base64 32` 生成 |
| `NEXTAUTH_URL` | 部署后的访问地址，如 `http://your-domain:3000` |
| `DATABASE_URL` | SQLite 数据库路径；源码默认 `file:./dev.db`，Docker 默认 `file:/app/data/dev.db` |
| `AI_PROVIDER` | AI 提供商，默认 `minimax`，取值见完整列表 |
| `<提供商>_API_KEY` | 对应提供商的 API Key，如 `MINIMAX_API_KEY`、`QWEN_API_KEY`、`OPENAI_API_KEY` |
| `TTS_MODE` | 动画语音讲解的朗读方式，默认 `browser`（浏览器本地语音） |
| `ALLOW_REGISTRATION` | 是否开放注册，默认 `false` |
| `AI_DAILY_LIMIT` | 普通用户每天的 AI 次数，默认 `0`（不限制） |

<details>
<summary><strong>完整环境变量列表</strong></summary>

**基础配置**

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | 数据库连接地址 | 源码 `file:./dev.db`；Docker `file:/app/data/dev.db` | SQLite 数据库路径 |
| `NEXTAUTH_SECRET` | Auth 密钥 | 无 | 用于加密 Session，生产环境必须设置，可用 `openssl rand -base64 32` 生成 |
| `NEXTAUTH_URL` | 访问地址 | 无 | 部署后的访问地址，如 `http://your-domain:3000` |
| `AUTH_TRUST_HOST` | 信任主机头 | Docker 镜像中为 `true` | 为 `true` 时根据请求自动推断访问地址，适合 Docker/反向代理 |
| `LOG_LEVEL` | 日志级别 | 开发 `debug` / 生产 `info` | 可选 `trace`、`debug`、`info`、`warn`、`error`、`fatal`，详见 [日志指南](doc/LOGGING_GUIDE.md) |
| `DEBUG_DB` | SQL 日志 | `false` | 为 `true` 时输出数据库查询日志 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 代理 | 无 | 访问 AI 服务时使用的代理 |
| `ALLOW_REGISTRATION` | 允许注册 | `false` | 为 `true` 时默认开放注册；管理员在「设置 → 用户管理」中保存的开关优先 |
| `AI_DAILY_LIMIT` | 每人每日 AI 次数 | `0`（不限制） | 普通用户每天可发起的 AI 操作次数，管理员不受限制；「设置 → 用户管理」中保存的值优先 |
| `TTS_MODE` | 动画语音讲解的朗读方式 | `browser` | `browser` 为浏览器本地语音；`minimax`、`qwen`、`glm`、`stepfun`、`volcengine`、`volcengine-agent`、`openai` 为云端语音，复用对应渠道的 API Key（豆包语音使用 `VOLCENGINE_TTS_API_KEY`，OpenAI 使用当前激活的 OpenAI 配置）。「设置 → AI 设置 → 语音讲解」中保存的值优先 |

**AI 配置**（网页中保存的配置优先于环境变量）

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `AI_PROVIDER` | AI 提供商 | `minimax` | 可选 `minimax`、`minimax-code`、`glm`、`deepseek`、`kimi`、`qwen`、`stepfun`、`volcengine`、`volcengine-agent`、`volcengine-coding`、`volcengine-free`、`anthropic`、`azure`、`openai`、`gemini` |
| `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` / `MINIMAX_MODEL` | MiniMax | 地址 `https://api.minimax.cn/v1`，模型 `MiniMax-M3.1-Flash` | 地址和模型可留空 |
| `MINIMAX_CODE_MODEL` | MiniMax Code 模型 | `MiniMax-M3.1-Flash` | 账号在网页设置中登录，无需 API Key |
| `MINIMAX_CODE_AUTO_CHECKIN` | MiniMax Code 每日自动签到 | `true` | 设为 `false` 关闭 |
| `GLM_API_KEY` / `GLM_BASE_URL` / `GLM_MODEL` | 智谱 GLM | 地址 `https://open.bigmodel.cn/api/paas/v4`，模型 `glm-5.3-flash` | 地址和模型可留空 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | DeepSeek | 地址 `https://api.deepseek.com`，模型 `deepseek-v4-flash` | 地址和模型可留空 |
| `KIMI_API_KEY` / `KIMI_BASE_URL` / `KIMI_MODEL` | Kimi | 地址 `https://api.moonshot.cn/v1`，模型 `kimi-k3.1-pro` | 地址和模型可留空 |
| `QWEN_API_KEY` / `QWEN_BASE_URL` / `QWEN_MODEL` | 千问 Qwen | 地址 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`（百炼 Token Plan），模型 `qwen3.8-max` | 按量付费的 Key 改填 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `STEPFUN_API_KEY` / `STEPFUN_BASE_URL` / `STEPFUN_MODEL` | 阶跃星辰 StepFun | 地址 `https://api.stepfun.com/step_plan/v1`（Step Plan 套餐），模型 `step-5-preview` | 按量付费改填 `https://api.stepfun.com/v1`，国际站 `https://api.stepfun.ai/v1` |
| `VOLCENGINE_API_KEY` / `VOLCENGINE_BASE_URL` / `VOLCENGINE_MODEL` | 火山引擎 豆包 | 地址 `https://ark.cn-beijing.volces.com/api/v3`，模型 `doubao-seed-2-1-lite-260915` | 按量付费；订阅 Agent Plan 等套餐时选择对应的套餐渠道；国际站 `https://ark.ap-southeast.bytepluses.com/api/v3` |
| `VOLCENGINE_AGENT_API_KEY` / `VOLCENGINE_AGENT_BASE_URL` / `VOLCENGINE_AGENT_MODEL` | 火山引擎 Agent Plan | 地址 `https://ark.cn-beijing.volces.com/api/plan/v3`，模型 `ark-code-latest` | Agent Plan 管理页的专属 API Key；套餐含豆包语音合成 |
| `VOLCENGINE_CODING_API_KEY` / `VOLCENGINE_CODING_BASE_URL` / `VOLCENGINE_CODING_MODEL` | 火山引擎 Coding Plan | 地址 `https://ark.cn-beijing.volces.com/api/coding/v3`，模型 `ark-code-latest` | 方舟 API Key；不要改成 `/api/v3`（不计入套餐）；套餐不含语音合成 |
| `VOLCENGINE_FREE_API_KEY` / `VOLCENGINE_FREE_BASE_URL` / `VOLCENGINE_FREE_MODEL` | 火山引擎（免费试用） | 地址 `https://ark.cn-beijing.volces.com/api/v3`，模型 `doubao-seed-2-1-lite-260915` | 新用户免费推理额度，开启「安心体验模式」后用完自动暂停 |
| `VOLCENGINE_TTS_API_KEY` | 豆包语音 API Key | 无 | 云端语音选择火山引擎豆包语音时使用，与火山方舟的 Key 不同 |
| `ANTHROPIC_API_KEY` | Anthropic API Key | 无 | 从 [Claude Console](https://platform.claude.com/) 获取 |
| `ANTHROPIC_BASE_URL` | API 地址 | `https://api.anthropic.com` | 兼容服务填写不含 `/v1` 的地址 |
| `ANTHROPIC_MODEL` | 模型 | `claude-sonnet-5-5` | 如 `claude-opus-5-5`、`claude-haiku-5-5` |
| `AZURE_OPENAI_API_KEY` | Azure API Key | 无 | 从 Azure 门户获取 |
| `AZURE_OPENAI_ENDPOINT` | Azure Endpoint | 无 | 如 `https://xxx.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT` | 部署名称 | 无 | Azure 中配置的部署名称 |
| `AZURE_OPENAI_API_VERSION` | API 版本 | `2024-02-15-preview` | |
| `AZURE_OPENAI_MODEL` | 模型名称 | `gpt-4o` | 仅用于显示 |
| `OPENAI_API_KEY` | OpenAI API Key | 无 | 从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取 |
| `OPENAI_BASE_URL` | OpenAI API 地址 | `https://api.openai.com/v1` | 使用兼容服务时填写其地址 |
| `OPENAI_MODEL` | OpenAI 模型 | `gpt-6.1-sol` | 兼容服务填写对应平台的模型 ID |
| `GOOGLE_API_KEY` | Gemini API Key | 无 | 从 [Google AI Studio](https://aistudio.google.com/apikey) 获取 |
| `GEMINI_BASE_URL` | Gemini API 地址 | 官方地址 | 通常无需修改 |
| `GEMINI_MODEL` | Gemini 模型 | `gemini-2.5-flash` | 推荐 `gemini-3.8-flash` |

**Openclaw 集成**（可选）

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `OPENCLAW_API_URL` | Openclaw agent 地址 | 无 | 本地部署的 Openclaw agent 服务地址 |
| `OPENCLAW_API_KEY` | Openclaw API 密钥 | 无 | 调用 Openclaw agent 时使用 |
| `OPENCLAW_TIMEOUT` | 超时（毫秒） | `30000` | |
| `OPENCLAW_AUTH_MODE` | 认证方式 | `credentials` | `credentials`（用户名密码）或 `apikey` |
| `OPENCLAW_INTEGRATION_API_KEY` | 本系统 API 密钥 | 无 | 仅 `apikey` 模式需要，供 Openclaw 调用本系统，可用 `openssl rand -hex 32` 生成 |

新增环境变量时需同步更新 `.env.example`。

</details>

## 📚 更多

### PWA（添加到主屏幕）

可将应用添加到手机或平板主屏幕，全屏运行、点击图标直接打开，平板可横屏使用。

- **iPhone / iPad (Safari)**：点击底部 **分享** 按钮 → 选择 **"添加到主屏幕"**。
- **Android (Chrome)**：点击右上角 **菜单** → 选择 **"添加到主屏幕"** 或 **"安装应用"**；也可以安装[安卓 App](#方式一安装包windows--macos--linux--飞牛os--安卓--npm)。

通过 HTTPS（或 `localhost`）访问时会启用 Service Worker：缓存页面脚本、样式和图标以加快打开速度，断网时显示离线提示页。题目、统计等数据始终从服务器读取，不做离线缓存。

### 屏幕截图（需要 HTTPS）

屏幕截图依赖浏览器的安全上下文（HTTPS）。在 Docker 或局域网环境中使用时，请参考 **[HTTPS 配置指南](doc/HTTPS_SETUP.md)** 启用内置 HTTPS 支持。

### 技术栈

- **框架**：[Next.js 16](https://nextjs.org/)（App Router）+ [React 19](https://react.dev/) + TypeScript
- **数据库**：[SQLite](https://www.sqlite.org/)（via [Prisma 5](https://www.prisma.io/)）
- **样式**：[Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/)（shadcn/ui 风格组件）
- **公式**：[KaTeX](https://katex.org/)（react-markdown + remark-math）
- **AI**：MiniMax / MiniMax Code（网页登录）/ 智谱 GLM / DeepSeek / Kimi / 千问 Qwen / 阶跃星辰 StepFun / 火山引擎豆包（含 Agent Plan、Coding Plan、免费试用）/ Anthropic（及兼容接口）/ Azure OpenAI / OpenAI（及兼容接口）/ Google Gemini
- **认证**：[NextAuth.js v4](https://next-auth.js.org/)
- **测试**：Vitest（单元、集成）、Playwright（E2E）

### 开发与测试

```bash
npm run lint                # ESLint（出现警告即失败）
npm run test:unit           # 单元测试
npm run test:integration    # 集成测试
npm test                    # 全部 Vitest 测试
npm run test:coverage       # 测试覆盖率（低于最低要求时失败）
npm run test:e2e            # Playwright E2E（先运行 node scripts/prepare-e2e.js 准备测试账号）
bash scripts/ci.sh          # 完整 CI（Node.js 22+、Python 3，含生产构建）
```

修改 `prisma/schema.prisma` 后使用 `npx prisma migrate dev --name <名称>` 生成正式迁移并提交；迁移须兼容已有数据。更多开发约定见 [AGENTS.md](AGENTS.md)。

### 实用脚本

`scripts/` 目录下提供维护和调试脚本，例如：

- **重置密码**：`node scripts/reset-password.js <邮箱> <新密码>`
- **重建管理员**：`node scripts/seed-admin.js`（默认 `admin@localhost` / `123456`）
- **重建系统知识点**：`npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/rebuild-system-tags.ts`（保留自定义标签和题目关联；生产环境操作前请先备份）
- **检查数据库**：`node scripts/check-db-users.js`、`node scripts/check-db-data.js`

### 文档

使用、部署和常见问题见 [Wiki](https://github.com/margrop/wrong-notebook/wiki)（另有 [English](https://github.com/margrop/wrong-notebook/wiki/Home-en) 版）。专项文档：

| 文档 | 内容 |
| :--- | :--- |
| [INSTALL_PACKAGES.md](doc/INSTALL_PACKAGES.md) | npm、桌面版、飞牛OS、安卓安装包与构建 |
| [HTTPS_SETUP.md](doc/HTTPS_SETUP.md) | HTTPS 配置（屏幕截图需要） |
| [TIME_ZONE.md](doc/TIME_ZONE.md) | 应用时区 |
| [LOGGING_GUIDE.md](doc/LOGGING_GUIDE.md) | 日志 |
| [MARKDOWN_GUIDE.md](doc/MARKDOWN_GUIDE.md) | Markdown 与公式 |
| [TABLE_RECOGNITION.md](doc/TABLE_RECOGNITION.md) | 表格识别 |
| [PROJECT_OVERVIEW.md](doc/PROJECT_OVERVIEW.md)、[operational_flow.md](doc/operational_flow.md) | 项目结构与操作流程（部分内容早于本仓库新增功能） |
| [release-guide.md](doc/release-guide.md) | 版本发布 |
| [BRANCH_WORKFLOW.md](doc/BRANCH_WORKFLOW.md) | 公开主线与上传前检查 |
| [setup-wsl-network.md](doc/setup-wsl-network.md) | WSL 网络配置 |

## 💬 交流与贡献

使用中遇到问题、想分享用法或提建议，欢迎加入 QQ 群 **964325781**，或用 QQ 扫描下方二维码。Bug 和功能需求仍建议提交到 [Issues](https://github.com/margrop/wrong-notebook/issues)，方便跟踪处理；在群里发截图前请隐去孩子姓名、学校、账号和访问地址。

<img src="doc/images/qq-group.webp" alt="智能错题本用户交流 QQ 群二维码，群号 964325781" width="240">

欢迎提交 Issue 和 Pull Request，请先阅读[贡献指南](CONTRIBUTING.md)和[行为准则](CODE_OF_CONDUCT.md)。提问和反馈方式见[获取帮助](SUPPORT.md)，安全漏洞请按[安全策略](SECURITY.md)私下报告。各正式版的改动见[更新日志](CHANGELOG.md)。

<a href="https://www.star-history.com/#margrop/wrong-notebook&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=margrop/wrong-notebook&amp;type=Date&amp;theme=dark">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=margrop/wrong-notebook&amp;type=Date">
    <img src="https://api.star-history.com/svg?repos=margrop/wrong-notebook&amp;type=Date" alt="margrop/wrong-notebook 的 GitHub Star 增长趋势图">
  </picture>
</a>

## 📄 许可证

[MIT License](LICENSE)

© 2026 margrop。本项目基于 [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook) 扩展，原项目代码版权归原作者所有。

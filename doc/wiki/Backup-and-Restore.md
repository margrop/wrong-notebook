# 数据备份与恢复

网页导出适合迁移个人学习数据；整站恢复应备份数据库、服务端配置和部署参数。

## 两种备份的范围

| 方式 | 包含内容 | 适用场景 |
| --- | --- | --- |
| 网页 JSON 导出（完整备份） | 错题本、系统及自定义标签、错题、复习计划、练习记录、随机错题试卷、真题库及题库题目、未处理的识别任务及部分用户资料 | 个人数据留存、受支持字段的导入 |
| 题目交换格式 JSON（导出 JSON） | 选中的错题题目内容（题干、答案、解析、知识点、难度、配图、可选原图） | 题目内容交换、跨系统导入 |
| 整站文件备份 | 完整 SQLite 数据库、`config/`、部署配置及需要的证书 | 灾难恢复、迁移整站、升级前回退准备 |

当前 JSON 导出不包含完整用户账户及密码、AI 数据授权或服务端 AI 配置。即使管理员选择导出全部数据，也不能替代整站备份。

## 网页导出与导入

在设置的数据管理入口导出 JSON，并妥善保存。普通用户导入时，导出文件中的用户邮箱通常必须与当前账户一致；备份来自其他账号时，可在确认后合并到当前账号，错题本、标签、题目和试卷全部归当前账号，不还原对方的偏好设置。管理员可以使用管理范围的全部数据导入导出。

完整备份含题目原图（保存为 WebP，浏览器不支持编码时为 JPEG）与已合成的云端语音，单个文件常见几十 MB，网页导出为 gzip 压缩的 JSON（文件名仍为 `.json`，网页导入自动解压，旧版纯 JSON 同样支持）。导入时先检查文件体积，解压后单个文件最大 256MB；超过上限会在上传前提示，服务端同样拒绝超限请求。

### 导出 JSON（题目交换格式）

错题本的多选栏提供「导出 JSON」功能，将选中的错题导出为[题目交换格式 JSON v1](https://github.com/margrop/wrong-notebook/blob/main/doc/QUESTION_FORMAT.md)文件。与完整备份不同，交换格式只包含题目内容（题干、答案、解析、知识点、难度、配图等），不含练习记录、复习计划、试卷、用户偏好等数据。

- 只导出属于当前用户的错题；不属于自己的 id 会被静默忽略。
- 可选「包含原图」：开启后，若原图是 base64 内嵌图片（PNG/JPEG/WebP），则放入 `images` 字段。
- 题干为空的题目会被跳过，并在响应 `warnings` 中计入 `EMPTY_QUESTION_TEXT_SKIPPED`。
- 导出结果可被 `parseQuestionFile` 直接解析，实现往返闭环。

### 完整备份导出

系统标签和自定义标签会保留标签体系及父子层级。不同年级下的同名章节、知识点分别还原，题目按备份中的标签关联恢复到具体节点；语文课程的年级、章节、知识点及其下的自定义标签也包含在内。导入兼容父子节点乱序的旧备份，重复导入不会重复创建同一路径的标签。

错题的配图、GeoGebra 演示、中英文 SVG 动画讲解及其已合成的云端语音（MP3）、最近一次举一反三和掌握概率都会随导出文件还原，SVG 在导入时重新净化；没有掌握概率的题目导入后会重新评估。试卷连同题目和每次录入的结果一起还原；导出时仍在生成的题目导入后显示为失败，可在试卷页重新生成。导入本人的导出文件时，还会还原录入年级识别规则及固定年级、导入前人工校对、判重阈值、GeoGebra 演示、SVG 动画讲解和界面主题等偏好设置。

导出文件为第 14 版：新增 `questionBanks`（真题库及题目）；待校对任务与未完成的多题批次不再导出，也不再参与导入，它们带整页图片，只在原设备继续处理。旧版备份中的这些字段导入时直接忽略，其余数据照常还原；导入本身不会调用 AI。
第 14 版起 `questionBanks` 记录真题库元信息与全部题目；旧版备份没有该字段时导入为空。导入按原题库 ID 去重，同名题库追加「（导入）」后缀，题目批量还原且不影响已有错题。

第 7 版起导出文件新增 `extensions` 命名空间，用于 fork 项目存放私有扩展数据（如题库元数据）。`extensions` 按 `<key>: { version, data }` 组织，每个扩展自行管理版本号；上游默认导出空对象 `{}`，导入时对未注册的 key 安全跳过并记录警告，版本高于当前程序支持的扩展同样跳过。fork 项目可在 `src/lib/backup-extensions.ts` 的 `BACKUP_EXTENSIONS` 数组中注册扩展。

第 8 版起 `examPapers` 新增 `mode` 字段（`generate` 举一反三 / `original` 原题直出）；旧版文件没有该字段时导入按 `generate` 处理。

第 9 版起 `errorItems` 新增 `questionType` 字段（题型，如单选题、填空题、计算题等）；旧版文件没有该字段时导入为 null。

第 10 版起 `examPapers.questions` 新增 `score` 字段（每题分值，最多一位小数）；旧版文件没有该字段时导入为未设分值。

第 11 版起 `examPapers` 新增 `groupByType` 字段（是否按题型分大题），`examPapers.questions` 新增 `questionType` 字段（创建试卷题目时快照的来源题型）；旧版文件没有这些字段时导入为 false / null。

恢复备份时保留题目原有年级，不应用当前录入年级规则；旧文件未包含规则时不会覆盖当前账户设置。

每道错题及每道试卷题目的配图显示比例与显示位置（居左/居中/居右）也会导出和还原，同时用于页面显示与打印；旧备份缺少此字段或值无效时使用默认 100% 和居中。

导入时会合并已有错题本、标签，并按题干相似度处理重复题目。重复题可能在已有题目下新增一次做错记录，因此反复导入同一份文件可能改变练习历史。

导入前保留原始备份，完成后核对新增题目、标签、重复题数量和作答历史。需要完整还原到某个时间点时，使用文件备份恢复。

## Docker 整站备份

下例适用于[部署指南](Deployment)中的目录布局。停止应用后再归档，可使 SQLite 数据文件、WAL/SHM 辅助文件及配置保持一致。

在部署目录执行：

```bash
mkdir -p backups
docker compose stop wrong-notebook
backup_file="backups/wrong-notebook-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$backup_file" data config docker-compose.yml .env
docker compose start wrong-notebook
tar -tzf "$backup_file"
```

备份失败时不要继续升级，先处理失败原因并确认服务恢复。使用内置 HTTPS 时，把 `certs/` 也加入归档；有额外部署文件时一并保存。

备份中可能含题目原图、用户资料、密码哈希和 AI 凭据，应限制访问并保存在独立位置。检查归档能够读取，并在隔离环境中验证恢复流程。

## Unraid 整站备份与恢复

Unraid 的容器数据在 `/mnt/user/appdata/wrong-notebook`（`data/` 与 `config/`）。容器环境变量（`NEXTAUTH_SECRET`、`NEXTAUTH_URL`）保存在 Unraid 的容器配置中，不在 appdata 目录内，迁移或重建容器时需要另行记录。
容器名不是 `wrong-notebook` 时，把下面命令中的名称替换为实际容器名。

停止容器后归档，可保证 SQLite 数据文件、WAL/SHM 辅助文件与配置一致：

```bash
appdata=/mnt/user/appdata/wrong-notebook
backups=/mnt/user/backups/wrong-notebook
mkdir -p "$backups"
docker stop wrong-notebook
backup_file="$backups/wrong-notebook-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$backup_file" -C /mnt/user/appdata wrong-notebook
docker start wrong-notebook
tar -tzf "$backup_file"
```

使用内置 HTTPS 或额外挂载了证书目录时，把对应目录也加入归档。也可以使用 Unraid 的 **Appdata Backup** 插件：把 `/mnt/user/appdata/wrong-notebook` 加入备份范围，插件会先停止容器再归档；恢复时用插件还原，或按下面的手动步骤操作。

备份失败时不要继续升级，先处理失败原因并确认容器恢复运行。归档中可能含题目原图、用户资料、密码哈希和 AI 凭据，应限制访问并保存在独立位置。

恢复步骤：

1. 确认备份时间、来源版本与归档内容，并记录当前容器的 Repository 标签、端口、路径映射和全部环境变量。
2. 在 Docker 页停止容器。
3. 把当前 `/mnt/user/appdata/wrong-notebook` 移到备份位置，再把归档解压到 `/mnt/user/appdata`：

   ```bash
   tar -xzf "$backups/wrong-notebook-YYYYMMDD-HHMMSS.tar.gz" -C /mnt/user/appdata
   ```

4. 保持原容器的路径映射与 `NEXTAUTH_SECRET`，优先使用与备份匹配的镜像版本；启动后在浏览器登录，核对用户、错题、标签、作答历史和试卷。
5. 需要升级时，在恢复验证完成后单独执行[升级流程](Deployment#unraid-docker-界面)。

不要把旧数据库直接交给不兼容的新旧版本反复切换。恢复后的容器与备份版本不匹配时，先确认数据可用，再按升级步骤切换镜像。

## 群晖 Container Manager 整站备份与恢复

数据目录为 `/volume1/docker/wrong-notebook`（`data/` 与 `config/`）；容器环境变量保存在 Container Manager 的容器配置中，迁移或重建容器时需另行记录。容器名不是 `wrong-notebook` 时，命令中的名称相应替换。

停止容器后归档：

```bash
appdata=/volume1/docker/wrong-notebook
backups=/volume1/backups/wrong-notebook
mkdir -p "$backups"
docker stop wrong-notebook
backup_file="$backups/wrong-notebook-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$backup_file" -C /volume1/docker wrong-notebook
docker start wrong-notebook
tar -tzf "$backup_file"
```

也可以使用 DSM 的 **Hyper Backup**：把 `/volume1/docker/wrong-notebook` 加入备份任务，任务执行前先停止容器；恢复时用 Hyper Backup 还原，或按下面的手动步骤操作。归档可能含题目原图、用户资料、密码哈希和 AI 凭据，应限制访问并保存在独立位置。

恢复：

1. 记录当前容器的映像标签、端口、卷映射和全部环境变量。
2. 在 Container Manager 中停止容器。
3. 把当前 `/volume1/docker/wrong-notebook` 移到备份位置，把归档解压到 `/volume1/docker`：

   ```bash
   tar -xzf "$backups/wrong-notebook-YYYYMMDD-HHMMSS.tar.gz" -C /volume1/docker
   ```

4. 保持原容器的卷映射与 `NEXTAUTH_SECRET`，优先使用与备份匹配的映像版本；启动后登录核对用户、错题、标签、作答历史和试卷。
5. 需要升级时，在恢复验证完成后单独执行[升级流程](Deployment#群晖-dsmcontainer-manager)。

## 威联通 Container Station 整站备份与恢复

数据目录为 `/share/Container/wrong-notebook`（`data/` 与 `config/`）；容器环境变量保存在 Container Station 的容器配置中，迁移或重建容器时需另行记录。容器名不是 `wrong-notebook` 时，命令中的名称相应替换。

停止容器后归档：

```bash
appdata=/share/Container/wrong-notebook
backups=/share/Backups/wrong-notebook
mkdir -p "$backups"
docker stop wrong-notebook
backup_file="$backups/wrong-notebook-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$backup_file" -C /share/Container wrong-notebook
docker start wrong-notebook
tar -tzf "$backup_file"
```

也可以使用 QNAP 的 **Hybrid Backup Sync**：把 `/share/Container/wrong-notebook` 加入备份任务，任务执行前先停止容器；恢复时用 Hybrid Backup Sync 还原，或按下面的手动步骤操作。归档可能含题目原图、用户资料、密码哈希和 AI 凭据，应限制访问并保存在独立位置。

恢复：

1. 记录当前容器的映像标签、端口、卷映射和全部环境变量。
2. 在 Container Station 中停止容器。
3. 把当前 `/share/Container/wrong-notebook` 移到备份位置，把归档解压到 `/share/Container`：

   ```bash
   tar -xzf "$backups/wrong-notebook-YYYYMMDD-HHMMSS.tar.gz" -C /share/Container
   ```

4. 保持原容器的卷映射与 `NEXTAUTH_SECRET`，优先使用与备份匹配的映像版本；启动后登录核对用户、错题、标签、作答历史和试卷。
5. 需要升级时，在恢复验证完成后单独执行[升级流程](Deployment#威联通-qtscontainer-station)。



## 恢复整站

1. 确认备份时间、来源版本和归档内容；保存当前数据与配置的另一份副本。
2. 停止应用，避免恢复过程中继续写入数据库。
3. 在独立目录解开备份并检查，再恢复 `data/`、`config/` 和所需部署文件。
4. 优先使用与备份匹配的镜像版本，保留正确的挂载路径和 `NEXTAUTH_SECRET`。
5. 启动后检查 `/api/health`，登录核对用户、错题、标签、作答历史和试卷。

不要把旧数据库直接交给不兼容的新旧版本反复切换。需要升级时，在恢复验证完成后单独执行[升级流程](Deployment)。

## 源码运行的备份

默认 SQLite 文件位于 `prisma/dev.db`，实际位置由 `DATABASE_URL` 决定。停止服务后备份实际数据库所在目录、`config/`、`.env` 和版本信息；恢复时使用匹配代码及依赖，再按需要执行正式迁移。

范围依据：[导出实现](https://github.com/margrop/wrong-notebook/blob/main/src/app/api/export/route.ts) · [导入实现](https://github.com/margrop/wrong-notebook/blob/main/src/app/api/import/route.ts) · [数据模型](https://github.com/margrop/wrong-notebook/blob/main/prisma/schema.prisma)。

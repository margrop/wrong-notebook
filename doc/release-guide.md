# 版本发布指南

本文档说明如何从公开 `main` 发布新版本 Docker 镜像。下例的 `github` 远程指向公开仓库；私有部署分支不能用于公开发版。

## 版本标签策略

项目以发布日期作为版本号，分为两类：

| 类型 | 格式 | 示例 | 何时使用 |
| --- | --- | --- | --- |
| 预览版（默认） | `v年.月.日-n` | `v2026.10.19-1` | 日常发布；`n` 为当天第几次发布，从 1 开始 |
| 正式版 | `v年.月.日` | `v2026.10.19` | **须经维护者确认后才能打**，AI 代理不得自行创建或推送 |

- 预览版不会更新 Docker `latest`，npm 发布到 `next` 标签，GitHub Release 标记为预发布。
- 正式版会更新 Docker `latest` 和 npm `latest`，发布前确认对应提交的 CI（含 E2E）已通过。

- 月、日不补零：2026 年 1 月 5 日写作 `v2026.1.5`，不能写成 `v2026.01.05`（npm 版本号不允许前导零）。
- 版本号在构建镜像时由 Git 标签自动得出（环境变量 `APP_VERSION`），发版无需修改代码。设置页「关于」和 `/api/health` 显示该版本号（不含 `v`）。
  - 推送标签触发的构建使用标签本身的版本，如 `2026.10.19`。
  - 其他构建（`scripts/build-image.sh`、手动镜像构建）使用 `git describe` 的结果；标签之后还有提交时形如 `2026.10.19-3-gabc1234`。
  - 取不到标签时（本地开发、浅克隆）回退到 `package.json` 的 `version`，该字段无需随发版更新。

## 发布操作流程

### 1. 确保代码已提交

```bash
git status
git add .
git commit -m "feat: 新功能描述"
git push github main
```

### 2. 正式版：更新 CHANGELOG.md

预览版跳过此步。正式版发布前，用 `scripts/changelog.sh` 把自上一个正式版以来的提交写入 [CHANGELOG.md](../CHANGELOG.md)，提交后再在该提交上打标签：

```bash
bash scripts/changelog.sh v2026.10.19
git add CHANGELOG.md
git commit -m "docs: 更新 CHANGELOG，发布 v2026.10.19"
git push github main
```

CHANGELOG.md 与 GitHub Release 说明使用同一脚本（`scripts/release-notes.sh`）按提交信息分类生成，每次运行都会整体重写，手动修改会被覆盖；因此提交信息应写成用户能看懂的改动说明。

### 3. 创建版本标签

```bash
# 默认创建预览版标签（当天日期 + 序号）
git tag v2026.10.19-1

# 正式版标签须经维护者确认后再创建
git tag v2026.10.19

# 或指定提交创建标签
git tag v2026.10.19 <commit-sha>
```

### 4. 推送标签触发构建

```bash
python3 scripts/check-public-history.py v2026.10.19-1
git push github v2026.10.19-1
git push origin v2026.10.19-1
```

首次发布后，GHCR 镜像默认为私有，需在 GitHub 的 Packages → wrong-notebook → Package settings 中改为 Public。

### 5. 查看构建状态

访问 GitHub 仓库的 **Actions** 页面查看构建进度。

## Windows 签名

Packages 工作流支持在 Windows 构建后、原有附件上传前接入 SignPath，配置步骤见 [WINDOWS_SIGNING.md](WINDOWS_SIGNING.md)。项目正在申请基金会授权，默认不启用；获批、配置完成并验证后才设置 `SIGNPATH_ENABLED=true`。

启用后每次签名都需维护者在 SignPath 人工批准。工作流等待并验证签名，成功后继续原有 Release 附件和校验和步骤；失败时停止，不回退到未签名包。不得为测试接入而重打已发布的正式标签或替换旧版附件。

## 自动生成的镜像标签

推送 `v2026.10.19` 标签后，CI 自动生成以下镜像标签：

| 标签 | 说明 |
|------|------|
| `2026.10.19` | 精确版本号 |
| `2026.10` | 当月最新版本 |
| `2026` | 当年最新版本 |
| `latest` | 最新版本 |
| `sha-xxxxxxx` | Git commit 短哈希 |

## 用户部署方式

```yaml
# docker-compose.yml
services:
  wrong-notebook:
    # 推荐：锁定精确版本
    image: ghcr.io/margrop/wrong-notebook:2026.10.19
    
    # 或：自动获取当月更新
    image: ghcr.io/margrop/wrong-notebook:2026.10
    
    # 不推荐：始终最新（生产环境慎用）
    image: ghcr.io/margrop/wrong-notebook:latest
```

## 常用命令

```bash
# 查看所有标签
git tag -l

# 删除本地标签
git tag -d v2026.10.19

# 删除远程标签
git push github --delete v2026.10.19

# 查看标签对应的提交
git show v2026.10.19
```

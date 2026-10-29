# 数据备份与恢复

网页导出适合迁移个人学习数据；整站恢复应备份数据库、服务端配置和部署参数。

## 两种备份的范围

| 方式 | 包含内容 | 适用场景 |
| --- | --- | --- |
| 网页 JSON 导出 | 错题本、自定义标签、错题、复习计划、练习记录、随机错题试卷及部分用户资料 | 个人数据留存、受支持字段的导入 |
| 整站文件备份 | 完整 SQLite 数据库、`config/`、部署配置及需要的证书 | 灾难恢复、迁移整站、升级前回退准备 |

当前 JSON 导出不包含完整用户账户及密码或服务端 AI 配置。即使管理员选择导出全部数据，也不能替代整站备份。

## 网页导出与导入

在设置的数据管理入口导出 JSON，并妥善保存。普通用户导入时，导出文件中的用户邮箱必须与当前账户一致；管理员可以使用管理范围的全部数据导入导出。

错题的配图、GeoGebra 演示、中英文 SVG 动画讲解及其已合成的云端语音（MP3）、最近一次举一反三和掌握概率都会随导出文件还原，SVG 在导入时重新净化；没有掌握概率的题目导入后会重新评估。试卷连同题目和每次录入的结果一起还原；导出时仍在生成的题目导入后显示为失败，可在试卷页重新生成。导入本人的导出文件时，还会还原导入前人工校对、判重阈值、GeoGebra 演示和 SVG 动画讲解等偏好设置。

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

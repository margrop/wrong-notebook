# wrong-notebook

错题本：上传题目图片或文字，由 AI 识别、解析并标注知识点，支持错题本管理、练习、统计与打印导出。

项目主页：<https://github.com/margrop/wrong-notebook>

## 安装与启动

需要 Node.js 22.15 及以上。

```bash
npm install -g wrong-notebook
wrong-notebook                 # 默认监听 0.0.0.0:3000
wrong-notebook --port 8080 --data-dir ~/wrong-notebook-data
```

浏览器打开 <http://127.0.0.1:3000>。首次启动时终端会打印一次性初始化链接（`/initialize?token=…`），打开后设置管理员邮箱和密码，再进入安装向导配置 AI 渠道并创建第一个错题本。

## 数据目录

默认 `~/.wrong-notebook`，可用 `--data-dir` 或环境变量 `WRONG_NOTEBOOK_HOME` 修改，其中包含：

| 文件 | 说明 |
| --- | --- |
| `wrong-notebook.db` | SQLite 数据库 |
| `config/app-config.json` | 应用设置（含 AI API Key） |
| `.nextauth_secret` | 登录会话密钥，首次启动自动生成 |

升级：`npm install -g wrong-notebook@latest`，启动时自动执行数据库迁移，已有数据保留。

## 常见问题

- 安装时需要从 Prisma 下载数据库引擎。国内网络较慢时可设置镜像后重装：
  `PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma npm install -g wrong-notebook`
- 使用 `--ignore-scripts` 安装时，首次启动会自动生成 Prisma Client，需要安装目录可写。
- 其余环境变量（如 `AI_PROVIDER`、`OPENAI_API_KEY`、`LOG_LEVEL`）与 Docker 部署相同，见仓库 `.env.example`。

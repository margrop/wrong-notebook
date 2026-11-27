# 在 Linux 上部署 wrong-notebook（免安装、用系统自带 Node）

本包是源码包，不含 node_modules 和数据库。在任意 Linux 机器上用系统已装的 Node 即可运行。
配套脚本：install.sh（一次性安装构建）、start.sh（启动服务，可重复执行）。

## 要求
- Linux（glibc / musl 均可），bash
- Node.js 20.9 或更高（官方 Docker 用 node 24，强烈建议）；npm 随 Node 自带
- openssl（一般系统都有；没有会退回用 node crypto）
- 首次安装需要联网下载依赖；国内建议走 npmmirror 镜像

## 快速开始

1. 解压

       tar -xzf wrong-notebook-2026.10.19-linux.tar.gz
       cd wrong-notebook

2. 一键安装并构建（约 5~10 分钟，看网速）

       ./install.sh

   国内网络加速（推荐）：

       NPM_REGISTRY=https://registry.npmmirror.com ./install.sh

3. 启动

       ./start.sh

   浏览器打开 http://服务器IP:3000

## 首次使用

- start.sh 会自动建库、迁移、初始化，并在日志里打印一次性链接 /initialize?token=...
- 打开该链接创建第一个管理员账号，然后登出、用账号正常登录。
- token 只打印这一次，用过即失效。忘了就删掉 prisma/dev.db 重新执行 ./start.sh 获取新 token。

## 从 Docker 迁移旧数据

之前用官方 Docker 跑的话，数据一般在你挂出来的两个目录：

    - data/：data/dev.db（数据库，全部错题/账号/标签，最重要） + data/.nextauth_secret（会话密钥） + data/.seed_completed（初始化标记）
    - config/：config/app-config.json、config/nextauth-secret、config/tts-cache/ 等

新路线默认把数据放在源码目录内（prisma/dev.db、.nextauth_secret、config/）。迁移 = 把旧的复制进来即可，应用启动时会自动复用已有文件，不会重新生成。

1. 解压进入新目录后，把旧数据复制进来（把 /opt/wrong 换成你的旧目录）：

       mkdir -p config
       [ -f /opt/wrong/data/dev.db.new ] && cp /opt/wrong/data/dev.db.new prisma/dev.db
       [ -f /opt/wrong/data/dev.db ]     && cp /opt/wrong/data/dev.db prisma/dev.db
       [ -f /opt/wrong/data/.seed_completed ] && cp /opt/wrong/data/.seed_completed .seed_completed
       [ -f /opt/wrong/data/.nextauth_secret ] && cp /opt/wrong/data/.nextauth_secret .nextauth_secret
       [ -d /opt/wrong/config ] && cp -r /opt/wrong/config/. config/

2. 正常安装启动：

       ./install.sh
       ./start.sh

   install.sh / start.sh 检测到已有数据（数据库非空 / 有 .seed_completed / 你设了 PRESERVE_EXISTING_DATA=true）时，会自动跳过会重建系统标签、重置 admin 的种子，只做增量补表结构和补种子，不会覆盖你的旧错题、旧账号、旧标签。

   若旧数据里的库文件叫 dev.db.new，就用第一条把它复制到 prisma/dev.db（Docker 常用 .new 后缀）；两个文件都有时，dev.db.new 更新。

3. 强烈建议先把旧的 data/ 和 config/ 完整备份一份再动手。

## 常用操作

- 换端口启动： PORT=8080 ./start.sh
- 日志级别： LOG_LEVEL=info ./start.sh
- 数据都在本目录内： prisma/dev.db（数据库）、.nextauth_secret（会话密钥）、config/app-config.json（配置）
- 备份： 直接复制/打包整个目录即可（含数据库）
- 升级： 用新源码覆盖本目录，重跑 ./install.sh，再 ./start.sh

## 装成 systemd 服务（可选，开机自启）

创建 /etc/systemd/system/wrong-notebook.service（把 WorkingDirectory 换成实际路径）：

       [Unit]
       Description=wrong-notebook
       After=network.target

       [Service]
       WorkingDirectory=/opt/wrong-notebook
       ExecStart=/opt/wrong-notebook/start.sh
       Environment=PORT=3000
       Restart=always

       [Install]
       WantedBy=multi-user.target

然后： sudo systemctl daemon-reload && sudo systemctl enable --now wrong-notebook

## 说明

- 本路线与官方 Docker 版等价：同一套安装命令（npm ci / prisma migrate deploy / prisma db seed / next build），只是数据放在项目目录内而非独立 DATA_DIR。
- 升级时如果 prisma schema 变了，install.sh 的 migrate deploy 会自动应用新迁移。

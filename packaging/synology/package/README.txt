错题本（群晖套件）
====================

本套件只管理 Docker 容器，服务端运行在 ghcr.io/margrop/wrong-notebook 镜像中；
发布的套件内置该镜像，安装时无需联网拉取。
需要 DSM 7.2.1 及以上，安装前请先在套件中心安装 Container Manager。

- 容器：Container Manager「项目」中的 wrong-notebook，随套件启停
- 端口：39300（主机）→ 3000（容器）
- 数据：套件数据目录 /volumeN/@appdata/wrongnotebook
- 初始化：首次启动后从 DSM 主菜单的「错题本」图标进入，按页面提示设置管理员账号
- 升级：套件中心升级套件后，容器会按新镜像重建，数据保留
- 卸载：移除容器和镜像但保留数据目录，重装后可继续使用

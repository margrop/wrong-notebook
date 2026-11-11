#!/bin/sh
# 威联通 QPKG 服务控制：start / stop / status / restart。
# 套件只负责 Docker 容器；数据放在 Container Station 的 Container 共享目录下，卸载套件不会删除。
set -eu

QPKG_NAME="wrongnotebook"
QPKG_DIR="${QPKG_DIR:-$(/sbin/getcfg "${QPKG_NAME}" Install_Path -f /etc/config/qpkg.conf 2>/dev/null || true)}"
if [ -z "${QPKG_DIR}" ] || [ ! -d "${QPKG_DIR}" ]; then
    echo "未找到 QPKG 安装目录" >&2
    exit 1
fi

if [ -d /share/Container ]; then
    DATA_ROOT=/share/Container/wrong-notebook
else
    DATA_ROOT="${QPKG_DIR}/data-root"
fi

WN_DATA_DIR="${DATA_ROOT}/data"
WN_CONFIG_DIR="${DATA_ROOT}/config"
WN_HOST_PORT=39300
WN_IMAGE_TAG="$(cat "${QPKG_DIR}/image-tag" 2>/dev/null || echo 0.0.0)"
# 内置镜像的套件把归档放在安装目录；在线套件没有该文件，启动时联网拉取
WN_IMAGE_ARCHIVE="${QPKG_DIR}/image.tar.gz"

. "${QPKG_DIR}/docker-container.sh"

setup_hint() {
    NAS_HOST="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo NAS)"
    echo "错题本已启动：http://${NAS_HOST}:39300/"
    if [ -s "${WN_CONFIG_DIR}/setup-token" ]; then
        echo "初始化链接：http://${NAS_HOST}:39300/initialize?token=$(cat "${WN_CONFIG_DIR}/setup-token")"
    fi
}

start() {
    wn_start_container
    setup_hint
}

stop() {
    wn_stop_container
    echo "stopped"
}

status() {
    if wn_status_container; then
        echo "running"
        return 0
    fi
    echo "stopped"
    return 1
}

case "${1:-start}" in
    start) start ;;
    stop) stop ;;
    status) status ;;
    restart) stop; sleep 1; start ;;
    remove) exit 0 ;;
    *) echo "Usage: $0 {start|stop|status|restart|remove}" >&2; exit 1 ;;
esac

#!/bin/sh
# 威联通 QPKG 的 Docker 容器控制（群晖套件改由 Container Manager 的 docker-project 资源管理容器）。
# 调用方先设置 WN_IMAGE_TAG、WN_DATA_DIR、WN_CONFIG_DIR，再 source 本文件；
# 套件内置镜像时另设 WN_IMAGE_ARCHIVE（docker save 导出的归档）。
set -eu

WN_CONTAINER_NAME="${WN_CONTAINER_NAME:-wrong-notebook}"
WN_HOST_PORT="${WN_HOST_PORT:-39300}"
WN_IMAGE_TAG="${WN_IMAGE_TAG:?WN_IMAGE_TAG 未设置}"
WN_IMAGE="${WN_IMAGE:-ghcr.io/margrop/wrong-notebook:${WN_IMAGE_TAG}}"

# 找到 docker CLI：PATH 中没有时检查 Container Manager / Container Station 的常见位置
wn_docker_bin() {
    if command -v docker >/dev/null 2>&1; then
        command -v docker
        return 0
    fi
    for candidate in \
        /usr/local/bin/docker \
        /usr/bin/docker \
        /var/packages/ContainerManager/target/usr/bin/docker \
        /share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker \
        /share/CACHEDEV2_DATA/.qpkg/container-station/bin/docker \
        /share/CACHEDEV3_DATA/.qpkg/container-station/bin/docker; do
        if [ -x "${candidate}" ]; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done
    return 1
}

wn_docker() {
    docker_bin="$(wn_docker_bin)" || {
        echo "未找到 docker CLI，请先安装 Container Manager（群晖）或 Container Station（威联通）" >&2
        return 1
    }
    "${docker_bin}" "$@"
}

wn_ensure_dirs() {
    mkdir -p "${WN_DATA_DIR}" "${WN_CONFIG_DIR}"
}

wn_generate_secret() {
    if [ -s "${WN_CONFIG_DIR}/nextauth-secret" ]; then
        return 0
    fi
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32 > "${WN_CONFIG_DIR}/nextauth-secret"
    else
        head -c 32 /dev/urandom | base64 | tr -d '\n\r' > "${WN_CONFIG_DIR}/nextauth-secret"
    fi
    chmod 600 "${WN_CONFIG_DIR}/nextauth-secret"
}

wn_has_image() {
    wn_docker image inspect "${WN_IMAGE}" >/dev/null 2>&1
}

# 准备镜像：本地已有时直接使用（重启和断网时不依赖镜像仓库）；
# 否则先加载套件内置的归档，没有归档或加载后仍缺少该版本时才联网拉取。
wn_ensure_image() {
    if wn_has_image; then
        return 0
    fi
    if [ -n "${WN_IMAGE_ARCHIVE:-}" ] && [ -s "${WN_IMAGE_ARCHIVE}" ]; then
        wn_docker load -i "${WN_IMAGE_ARCHIVE}" >/dev/null || echo "加载内置镜像失败，改为联网拉取" >&2
        if wn_has_image; then
            return 0
        fi
    fi
    wn_docker pull --quiet "${WN_IMAGE}" >/dev/null
}

# 升级后清理本套件其他版本的镜像，避免每次升级多占一份空间；仍被使用的镜像删除会失败，忽略即可
wn_prune_old_images() {
    repo="${WN_IMAGE%:*}"
    for old in $(wn_docker images --format '{{.Repository}}:{{.Tag}}' "${repo}" 2>/dev/null); do
        if [ "${old}" != "${WN_IMAGE}" ]; then
            wn_docker rmi "${old}" >/dev/null 2>&1 || true
        fi
    done
}

wn_wait_health() {
    for _ in $(seq 1 120); do
        if command -v curl >/dev/null 2>&1 && curl -sf "http://127.0.0.1:${WN_HOST_PORT}/api/health" >/dev/null 2>&1; then
            return 0
        fi
        running="$(wn_docker inspect -f '{{.State.Running}}' "${WN_CONTAINER_NAME}" 2>/dev/null || echo false)"
        if [ "${running}" != "true" ]; then
            echo "容器已退出，最近日志：" >&2
            wn_docker logs --tail 20 "${WN_CONTAINER_NAME}" >&2 || true
            return 1
        fi
        sleep 1
    done
    echo "健康检查超时，容器仍在运行；首次启动可能仍在初始化数据库" >&2
    return 0
}

wn_start_container() {
    wn_ensure_dirs
    wn_generate_secret
    wn_ensure_image
    wn_docker rm -f "${WN_CONTAINER_NAME}" >/dev/null 2>&1 || true
    wn_docker run -d \
        --name "${WN_CONTAINER_NAME}" \
        --restart unless-stopped \
        -p "${WN_HOST_PORT}:3000" \
        -v "${WN_DATA_DIR}:/app/data" \
        -v "${WN_CONFIG_DIR}:/app/config" \
        -e PRESERVE_EXISTING_DATA=true \
        -e AUTH_TRUST_HOST=true \
        -e NEXTAUTH_SECRET="$(cat "${WN_CONFIG_DIR}/nextauth-secret")" \
        "${WN_IMAGE}" >/dev/null
    wn_prune_old_images
    wn_wait_health
}

wn_stop_container() {
    if wn_docker inspect "${WN_CONTAINER_NAME}" >/dev/null 2>&1; then
        wn_docker stop -t 20 "${WN_CONTAINER_NAME}" >/dev/null 2>&1 || true
        wn_docker rm -f "${WN_CONTAINER_NAME}" >/dev/null 2>&1 || true
    fi
}

wn_status_container() {
    running="$(wn_docker inspect -f '{{.State.Running}}' "${WN_CONTAINER_NAME}" 2>/dev/null || echo false)"
    [ "${running}" = "true" ]
}

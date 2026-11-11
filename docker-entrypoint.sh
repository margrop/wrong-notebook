#!/bin/sh
set -e

# Define paths
SOURCE_DB="/app/prisma/dev.db"
TARGET_DB="/app/data/dev.db"
SEED_MARKER="/app/data/.seed_completed"
VERSION_FILE="/app/data/.app_version"
# Use local Prisma CLI from node_modules
PRISMA_BIN="node /app/node_modules/prisma/build/index.js"
SEED_ADMIN_SCRIPT="/app/dist-scripts/scripts/seed-admin.js"
REBUILD_TAGS_SCRIPT="/app/dist-scripts/scripts/rebuild-system-tags.js"
SEED_CHINESE_TAGS_SCRIPT="/app/dist-scripts/scripts/seed-chinese-primary.js"
SEED_UNIVERSITY_GRADES_SCRIPT="/app/dist-scripts/scripts/seed-university-grades.js"

# Get current app version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

# 配置目录默认 /app/config，可用 CONFIG_DIR 放到数据卷内
CONFIG_PATH="${CONFIG_DIR:-/app/config}"

# 以 root 启动时修正数据和配置目录的属主，并降权到 nextjs 运行；
# 以其他用户启动时（如群晖 docker-project 强制使用套件用户）无法也无需改属主，直接以当前用户运行。
if [ "$(id -u)" = "0" ]; then
    RUN_AS="su-exec nextjs:nodejs"
    mkdir -p "$CONFIG_PATH"
    chown -R nextjs:nodejs /app/data "$CONFIG_PATH"
else
    RUN_AS=""
    mkdir -p "$CONFIG_PATH"
fi

# 仅在 root 下有效：把文件属主交给运行用户
own() {
    if [ -n "$RUN_AS" ]; then
        chown nextjs:nodejs "$@"
    fi
}

# 未设置 NEXTAUTH_SECRET 时在数据目录生成并保存，重启和升级后保持不变（与安装包启动器一致）
if [ -z "${NEXTAUTH_SECRET:-}" ]; then
    SECRET_FILE="/app/data/.nextauth_secret"
    if [ ! -s "$SECRET_FILE" ]; then
        echo "[Entrypoint] NEXTAUTH_SECRET 未设置，生成并保存到 $SECRET_FILE"
        (umask 077 && openssl rand -base64 32 > "$SECRET_FILE")
        own "$SECRET_FILE"
    fi
    NEXTAUTH_SECRET="$(cat "$SECRET_FILE")"
    export NEXTAUTH_SECRET
fi

# Remember whether this is an existing installation before copying seed data.
DB_ALREADY_EXISTS=false
# Check if the persistent database exists
if [ ! -s "$TARGET_DB" ]; then
    echo "[Entrypoint] Initializing database..."
    if [ -f "$SOURCE_DB" ]; then
        echo "[Entrypoint] Copying pre-packaged database from $SOURCE_DB to $TARGET_DB"
        cp "$SOURCE_DB" "$TARGET_DB"
        # Ensure correct permissions
        own "$TARGET_DB"
        # Mark as seeded since pre-packaged DB includes seed data
        touch "$SEED_MARKER"
        # Record initial version
        echo "$CURRENT_VERSION" > "$VERSION_FILE"
    else
        echo "[Entrypoint] Source database not found at $SOURCE_DB. Initializing with migrations."
    fi
else
    DB_ALREADY_EXISTS=true
    echo "[Entrypoint] Database already exists at $TARGET_DB."
fi

# Check for version upgrade
PREVIOUS_VERSION=""
if [ -f "$VERSION_FILE" ]; then
    PREVIOUS_VERSION=$(cat "$VERSION_FILE")
fi

# Run migrations to ensure DB schema is available and up to date.
echo "[Entrypoint] Running database migrations to sync schema..."
cd /app
if ! $PRISMA_BIN migrate deploy --schema=./prisma/schema.prisma; then
    echo "[Entrypoint] Database migration failed; refusing to start." >&2
    exit 1
fi
echo "[Entrypoint] Migrations completed successfully."

# Bootstrap new installations; deployments preserve existing account state.
if [ "$DB_ALREADY_EXISTS" = "true" ] && [ "${PRESERVE_EXISTING_DATA:-false}" = "true" ]; then
    echo "[Entrypoint] Preserving existing accounts; skipping admin seed."
else
    echo "[Entrypoint] Restoring admin role for the existing default admin, if any..."
    node "$SEED_ADMIN_SCRIPT"
fi
touch "$SEED_MARKER" 2>/dev/null

# Check if version changed - rebuild system tags automatically
if [ "$PREVIOUS_VERSION" != "$CURRENT_VERSION" ]; then
    echo "[Entrypoint] Version upgrade detected: $PREVIOUS_VERSION -> $CURRENT_VERSION"
    if [ "$DB_ALREADY_EXISTS" = "true" ] && [ "${PRESERVE_EXISTING_DATA:-false}" = "true" ]; then
        echo "[Entrypoint] Preserving existing system tags and associations."
    else
        echo "[Entrypoint] Rebuilding system tags to sync with new version..."
        node "$REBUILD_TAGS_SCRIPT"
    fi
    # Update version marker
    echo "$CURRENT_VERSION" > "$VERSION_FILE"
fi

# 旧安装保留标签时也增量补齐语文课程，不重建已有标签或修改题目关联。
node "$SEED_CHINESE_TAGS_SCRIPT"

# 同样增量补齐大学年级根节点，供大学错题本挂载 AI 生成的标签。
node "$SEED_UNIVERSITY_GRADES_SCRIPT"

# HTTPS Setup
CERT_DIR="/app/certs"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

if [ "$HTTPS_ENABLED" = "true" ]; then
    echo "[Entrypoint] HTTPS enabled"
    
    # 确保证书目录存在
    mkdir -p "$CERT_DIR"
    own "$CERT_DIR"
    
    # 检查证书是否存在
    if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
        echo "[Entrypoint] 证书不存在，自动生成自签名证书..."
        
        # 获取证书 CN（优先使用环境变量，否则使用 localhost）
        CERT_CN="${CERT_DOMAIN:-localhost}"
        
        # 生成自签名证书（有效期 10 年）
        openssl req -x509 -newkey rsa:2048 \
            -keyout "$KEY_FILE" \
            -out "$CERT_FILE" \
            -days 3650 \
            -nodes \
            -subj "/CN=$CERT_CN" \
            2>/dev/null
        
        if [ $? -eq 0 ]; then
            echo "[Entrypoint] 自签名证书生成成功: CN=$CERT_CN"
            own "$CERT_FILE" "$KEY_FILE"
        else
            echo "[Entrypoint] 警告: 证书生成失败，HTTPS 将不可用"
        fi
    else
        echo "[Entrypoint] 使用已有证书: $CERT_FILE"
    fi
    
    # 启动 HTTPS 代理
    if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
        echo "[Entrypoint] 启动 HTTPS 代理 (端口 443)..."
        $RUN_AS node /app/https-server.js &
    fi
fi

# 以 root 启动时降权到 nextjs，否则以当前用户执行主命令
exec $RUN_AS "$@"

#!/usr/bin/env bash
# wrong-notebook 启动脚本：自动迁移/补 seed，再用系统 node 启动
# 用法: ./start.sh    换端口: PORT=8080 ./start.sh
set -uo pipefail
cd "$(dirname $0)"

if [ ! -d node_modules ]; then
  echo "[start] 尚未安装构建，请先运行 ./install.sh" >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo "[start] 未找到 node" >&2; exit 1; }

: "${PORT:-3000}"
: "${HOST:-0.0.0.0}"
export PORT
export HOST

if [ -f .nextauth_secret ]; then
  NEXTAUTH_SECRET="$(cat .nextauth_secret)"
else
  if command -v openssl >/dev/null 2>&1; then
    NEXTAUTH_SECRET="$(openssl rand -base64 32)"
  else
    NEXTAUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" )"
  fi
  printf "%s" "$NEXTAUTH_SECRET" > .nextauth_secret
  chmod 600 .nextauth_secret 2>/dev/null || true
fi
export NEXTAUTH_SECRET

: "${DATABASE_URL:-file:./dev.db}"
export DATABASE_URL
: "${AUTH_TRUST_HOST:-true}"
export AUTH_TRUST_HOST

npx prisma migrate deploy --schema=./prisma/schema.prisma
npx prisma db seed || true
existing_data=false
if [ -f .seed_completed ]; then existing_data=true; fi
if [ -f prisma/dev.db ] && [ "$(stat -c %s prisma/dev.db 2>/dev/null || echo 0)" -gt 102400 ]; then existing_data=true; fi
if [ -f prisma/dev.db.new ] && [ "$(stat -c %s prisma/dev.db.new 2>/dev/null || echo 0)" -gt 102400 ]; then existing_data=true; fi
if [ "${PRESERVE_EXISTING_DATA:-}" = "true" ] || [ "${PRESERVE_EXISTING_DATA:-}" = "1" ]; then existing_data=true; fi
if [ -d dist-scripts ]; then
if [ "$existing_data" = "true" ]; then echo "[start] 检测到已有数据，跳过 rebuild-system-tags（保留旧数据）"; fi
if [ "$existing_data" != "true" ]; then node dist-scripts/rebuild-system-tags.js || true; fi
  node dist-scripts/seed-chinese-primary.js || true
  node dist-scripts/seed-university-grades.js || true
fi

echo "[start] 正在启动，服务地址 http://$HOST:$PORT"
npx next start -H "$HOST" -p "$PORT"

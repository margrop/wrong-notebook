#!/usr/bin/env bash
# wrong-notebook 一次性安装脚本（Linux，用系统自带 Node/npm）
# 国内网络加速: NPM_REGISTRY=https://registry.npmmirror.com ./install.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "[install] 检查 Node 版本 (需要 >= 20.9, 推荐 22/24) ..."
if command -v node >/dev/null 2>&1; then
  if ! node -e "const n=process.versions.node.split('.').map(Number);process.exit(n[0]>20||(n[0]===20&&n[1]>=9)?0:1)"; then
    echo "[install] 当前 Node $(node -v) 过低，请安装 Node 20.9 以上后重新运行 ./install.sh" >&2
    exit 1
  fi
  echo "[install] Node $(node -v) OK"
else
  echo "[install] 未找到 node，请先安装 Node 20.9+ 再运行本脚本" >&2
  exit 1
fi
command -v npm >/dev/null 2>&1 || { echo "[install] 未找到 npm" >&2; exit 1; }

# 国内网络时设 NPM_REGISTRY 走镜像，并联动 Prisma 引擎镜像
npm_registry="${npm_registry:-https://registry.npmjs.org}"
if [ "$npm_registry" != "https://registry.npmjs.org" ]; then
  export PRISMA_ENGINES_MIRROR="https://registry.npmmirror.com/-/binary/prisma"
fi

# --- .env ---------------------------------------------------------------
# Prisma CLI 只从 .env 或环境变量读取 DATABASE_URL，源码安装不会自动生成 .env。
# 缺了它，第 4 步会在 prisma migrate deploy 处报 P1012。
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "[install] 未找到 .env，已从 .env.example 复制"
  else
    : > .env
    echo "[install] 未找到 .env，已生成默认 SQLite 配置"
  fi
fi
grep -q '^DATABASE_URL=' .env || printf 'DATABASE_URL="file:./dev.db"\n' >> .env
# .env.example 里的 NEXTAUTH_SECRET 常常是空值，必须判断"有值"而不是"有这一行"
if ! grep -qE '^NEXTAUTH_SECRET=.+' .env; then
  _secret="$(openssl rand -base64 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
  if grep -qE '^NEXTAUTH_SECRET=' .env; then
    sed -i.bak "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\"${_secret}\"|" .env
    rm -f .env.bak
  else
    printf 'NEXTAUTH_SECRET="%s"\n' "$_secret" >> .env
  fi
  unset _secret
  echo "[install] 已生成 NEXTAUTH_SECRET 写入 .env"
fi
chmod 600 .env 2>/dev/null || true

# dist-scripts 下的脚本是直接用 node 跑的，而 Prisma Client 不会自己读 .env，
# 这里从 .env 取出 DATABASE_URL 并导出（不整体 source，避免 api key 里的特殊字符被执行）
_env_database_url="$(sed -nE 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*"?([^"#]*)"?.*$/\1/p' .env | head -n1)"
: "${DATABASE_URL:=${_env_database_url:-file:./dev.db}}"
export DATABASE_URL
unset _env_database_url

echo "[install] [1/6] npm ci"
# 显式带上 devDependencies：后面的 tsc 编译与 next build（tailwind/postcss 等）都依赖它们，
# 只读环境里预设了 NODE_ENV=production 时才不会把构建依赖误裁掉。
npm ci --include=dev --registry "$npm_registry" --no-audit --no-fund

echo "[install] [2/6] npx prisma generate"
npx prisma generate

echo "[install] [3/6] 编译 seed 辅助脚本到 dist-scripts"
# 用项目内 pin 的 typescript（devDependency），不要用全局 tsc：
# 全局版本不受控，TypeScript 6 起"命令行指定文件 + 目录里存在 tsconfig.json"会直接报 TS5112
tsc_bin="./node_modules/.bin/tsc"
if [ ! -x "$tsc_bin" ]; then
  echo "[install] 未找到项目内 typescript，按 devDependency 补装 5.x"
  npm i --no-save --registry "$npm_registry" --no-audit --no-fund typescript@5
fi
if [ ! -x "$tsc_bin" ]; then
  echo "[install] typescript 不可用，无法编译 dist-scripts" >&2
  exit 1
fi
rm -rf dist-scripts
# --rootDir . 固定产物布局：脚本 import 了 ../src，公共根目录会从 scripts/ 上浮到仓库根，
# 产物落在 dist-scripts/scripts/ 与 dist-scripts/src/ 下，与 Dockerfile / docker-entrypoint.sh 一致
"$tsc_bin" scripts/rebuild-system-tags.ts scripts/seed-chinese-primary.ts scripts/seed-university-grades.ts \
     --rootDir . --outDir dist-scripts \
     --esModuleInterop --resolveJsonModule --skipLibCheck --module commonjs --target ES2022
mkdir -p dist-scripts/scripts
cp scripts/seed-admin.js dist-scripts/scripts/
# 产物布局变了就立刻失败，别拖到第 4 步才报 MODULE_NOT_FOUND
for f in scripts/rebuild-system-tags.js scripts/seed-chinese-primary.js scripts/seed-university-grades.js; do
  if [ ! -f "dist-scripts/$f" ]; then
    echo "[install] 编译产物缺失: dist-scripts/$f（tsc 输出布局变了？）" >&2
    exit 1
  fi
done

# 保护已有数据：已有数据库 / .seed_completed / PRESERVE_EXISTING_DATA=true 时，跳过会重建标签、重置 admin 的种子
existing_data=false
if [ -f .seed_completed ]; then existing_data=true; fi
if [ -f prisma/dev.db ] && [ "$(stat -c %s prisma/dev.db 2>/dev/null || echo 0)" -gt 102400 ]; then existing_data=true; fi
if [ -f prisma/dev.db.new ] && [ "$(stat -c %s prisma/dev.db.new 2>/dev/null || echo 0)" -gt 102400 ]; then existing_data=true; fi
if [ "${PRESERVE_EXISTING_DATA:-}" = "true" ] || [ "${PRESERVE_EXISTING_DATA:-}" = "1" ]; then existing_data=true; fi
if [ "$existing_data" = "true" ]; then echo "[install] 检测到已有数据，将保留（不重建系统标签）"; fi
echo "[install] [4/6] 数据库迁移 + 初始化 seed"
npx prisma migrate deploy --schema=./prisma/schema.prisma
npx prisma db seed
if [ "$existing_data" = "true" ]; then
  echo "[install] 检测到已有数据，跳过 seed-admin/rebuild-system-tags（保留旧数据）"
else
  node dist-scripts/scripts/seed-admin.js
  node dist-scripts/scripts/rebuild-system-tags.js
fi
node dist-scripts/scripts/seed-chinese-primary.js
node dist-scripts/scripts/seed-university-grades.js

echo "[install] [5/6] npm run build"
npm run build

echo "[install] [6/6] 完成"
echo "[install] 现在运行 ./start.sh 启动，然后浏览器访问 http://服务器IP:3000"
echo "[install] 首次启动日志会打印一次性链接 /initialize?token=...，请尽快用它创建管理员账号"

ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
# 测试与构建需要的系统包放在复制源码之前，源码变化时不必重新下载
RUN apk add --no-cache libc6-compat python3 openssl bash
WORKDIR /app

# Install dependencies and generate Prisma Client once; cached until lockfile or schema changes
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund && npx prisma generate

# Pre-compile runtime scripts and initialize seed database in an isolated stage
# so code-only changes reuse the cached database layer and BuildKit can run it in parallel.
FROM deps AS db-builder
ENV DATABASE_URL="file:/app/prisma/dev.db"
COPY prisma ./prisma
COPY scripts/rebuild-system-tags.ts scripts/seed-chinese-primary.ts scripts/seed-admin.js ./scripts/
COPY src/lib/tag-data ./src/lib/tag-data
COPY src/lib/seed-chinese-tags.ts src/lib/error-message.ts src/lib/logger.ts src/lib/debug-log.ts ./src/lib/
RUN npx tsc scripts/rebuild-system-tags.ts scripts/seed-chinese-primary.ts --outDir dist-scripts --esModuleInterop --resolveJsonModule --skipLibCheck --module commonjs --target ES2022 \
    && npx prisma migrate deploy \
    && npx prisma db seed \
    && node ./dist-scripts/scripts/rebuild-system-tags.js

# CI uses the same Node version and native dependencies as production builds.
FROM deps AS ci
WORKDIR /app
# QEMU 模拟构建其他架构时测试会慢数倍，可调大单个测试和钩子的超时（毫秒）
ARG TEST_TIMEOUT_MS=5000
COPY . .
RUN npm test -- --testTimeout="${TEST_TIMEOUT_MS}" --hookTimeout="${TEST_TIMEOUT_MS}" \
    && sh -n docker-entrypoint.sh \
    && bash -n scripts/ci.sh scripts/build-image.sh

# Rebuild the source code only after the checks pass.
FROM ci AS builder

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1

# 挂载 .next/cache 避免将构建缓存写入镜像层；清理 standalone 中被文件追踪带入的源码与重复的 Prisma 副本
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build \
    && find .next/standalone -mindepth 1 -maxdepth 1 \
       ! -name 'server.js' ! -name 'package.json' ! -name '.next' ! -name 'node_modules' \
       -exec rm -rf {} + \
    && rm -rf .next/standalone/node_modules/.prisma .next/standalone/node_modules/@prisma

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Existing installations keep their accounts and tag IDs during deployment.
ENV PRESERVE_EXISTING_DATA=true
ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# set hostname to localhost
ENV HOSTNAME="0.0.0.0"
# Point to the persistent data location
ENV DATABASE_URL="file:/app/data/dev.db"
ENV AUTH_TRUST_HOST=true

# Install dependencies, create user and persistent data directory before revision args so this layer stays cached
RUN apk add --no-cache su-exec openssl \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs \
    && mkdir -p /app/data \
    && chown -R nextjs:nodejs /app/data

# Copy Prisma CLI and engine files from deps (cached across source changes)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Copy Prisma schema, migrations, pre-seeded database and runtime scripts from db-builder
COPY --from=db-builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=db-builder --chown=nextjs:nodejs /app/dist-scripts ./dist-scripts
COPY --from=db-builder --chown=nextjs:nodejs /app/scripts/seed-admin.js ./dist-scripts/scripts/seed-admin.js

# Copy static assets, config and entrypoint scripts
COPY public ./public
COPY --chown=nextjs:nodejs config ./config
COPY --chown=nextjs:nodejs --chmod=755 docker-entrypoint.sh ./
COPY --chown=nextjs:nodejs https-server.js ./

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

ARG APP_REVISION=unknown
ENV APP_REVISION=${APP_REVISION}
# 由 Git 标签得出的版本号，留空时运行时回退到 package.json 的版本
ARG APP_VERSION=
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.source="https://github.com/margrop/wrong-notebook" \
      org.opencontainers.image.revision="${APP_REVISION}" \
      org.opencontainers.image.version="${APP_VERSION}"

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"

# Use entrypoint script to handle DB initialization
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

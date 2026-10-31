# 日志系统使用指南 (v1.2.0)

**状态**: ✅ 稳定运行
**更新时间**: 2025-12-19

## 📋 目录

- [概述](#概述)
- [使用方法](#使用方法)
- [日志级别](#日志级别)
- [最佳实践](#最佳实践)
- [故障排查](#故障排查)
- [前端日志](#前端日志-frontend-logger)
- [调试模式与调试日志导出](#调试模式与调试日志导出)

---

## 概述

项目使用**自定义轻量级结构化 logger**，位于 `src/lib/logger.ts`。

### 特点

- ✅ 无外部依赖，完全兼容 Next.js Turbopack
- ✅ 结构化 JSON 日志输出
- ✅ 支持 `LOG_LEVEL` 环境变量控制
- ✅ 模块化 child logger
- ✅ API 与 pino 兼容

### 为什么不使用 pino？

`pino` 使用 `thread-stream` 进行多线程日志传输，这与 Next.js Turbopack 打包机制不兼容。因此我们移除了 `pino` 相关依赖，实现了完全兼容其 API 的轻量级替代方案，确保了开发体验和构建稳定性。

---

## 使用方法

### 1. 导入 logger

```typescript
import { createLogger } from '@/lib/logger';

const logger = createLogger('your-module-name');
```

### 2. 命名规范

| 模块类型 | 命名格式 | 示例 |
|---------|---------|------|
| API 路由 | `api:路径` | `api:analyze`, `api:tags:suggestions` |
| 库文件 | `模块名` | `auth`, `proxy`, `config` |
| AI 层 | `ai:子模块` | `ai:openai`, `ai:gemini`, `ai:tag-service` |

### 3. 基本用法

```typescript
// 简单消息
logger.info('Server started');

// 带上下文数据
logger.info({ userId: 123, action: 'login' }, 'User logged in');

// 调试信息
logger.debug({ requestBody: data }, 'Processing request');

// 警告
logger.warn({ config: 'missing' }, 'Using default configuration');

// 错误处理
try {
    // ...
} catch (error) {
    logger.error({ error }, 'Operation failed');
}
```

### 4. 装饰性日志（用于调试）

用于输出带边框和 Emoji 的美化日志，适合 AI 调用等需要详细追踪的场景：

```typescript
// 带边框的标题和内容
logger.box('🔍 AI Image Analysis Request', {
    imageSize: '413868 bytes',
    mimeType: 'image/jpeg',
    model: 'gpt-4o'
});

// 输出完整 JSON
logger.box('📤 API Request', JSON.stringify(requestParams, null, 2));

// 分隔线
logger.divider();
logger.divider('=');  // 使用 = 作为分隔符
```

**输出效果**（仅开发环境）：

```
================================================================================
[ai:openai] 🔍 AI Image Analysis Request
================================================================================
imageSize: 413868 bytes
mimeType: image/jpeg
model: gpt-4o
--------------------------------------------------------------------------------
```

---

## 日志级别

### 级别定义

| 级别 | 数值 | 使用场景 | 示例 |
|------|-----|---------|------|
| `trace` | 10 | 最详细的追踪 | 函数入口/出口 |
| `debug` | 20 | 调试信息 | 请求参数、中间结果 |
| `info` | 30 | 重要业务事件 | 用户登录、API 请求成功 |
| `warn` | 40 | 警告但不影响运行 | 配置缺失、弃用功能 |
| `error` | 50 | 错误和异常 | 数据库连接失败、API 错误 |
| `fatal` | 60 | 致命错误 | 系统无法启动 |

### 环境配置

在 `.env` 文件中设置：

```env
# 开发环境 - 显示所有日志
LOG_LEVEL=debug

# 生产环境 - 只显示 info 及以上
LOG_LEVEL=info

# 静默模式 - 只显示错误
LOG_LEVEL=error
```

---

## 最佳实践

### 1. 结构化优于字符串拼接

❌ **错误**:
```typescript
logger.info(`User ${userId} logged in at ${timestamp}`);
```

✅ **正确**:
```typescript
logger.info({ userId, timestamp }, 'User logged in');
```

### 2. 上下文数据与消息分离

❌ **错误**:
```typescript
logger.info('Processing request with data: ' + JSON.stringify(data));
```

✅ **正确**:
```typescript
logger.info({ data }, 'Processing request');
```

### 3. 错误日志包含完整信息

❌ **错误**:
```typescript
logger.error('Something failed');
```

✅ **正确**:
```typescript
logger.error({ error, context: 'additional info' }, 'Operation failed');
```

### 4. 敏感信息脱敏

❌ **不要记录**:
```typescript
logger.info({ password: credentials.password }, 'Login attempt');
```

✅ **记录布尔值或长度**:
```typescript
logger.info({ 
    email: credentials.email,
    hasPassword: !!credentials.password 
}, 'Login attempt');
```

### 5. 避免记录大对象

❌ **错误**:
```typescript
logger.debug({ hugeObject }, 'Processing');
```

✅ **正确**:
```typescript
logger.debug({
    id: hugeObject.id,
    type: hugeObject.type,
    itemCount: hugeObject.items?.length
}, 'Processing');
```

---

## 故障排查

### 问题 1: 日志未显示

**原因**: `LOG_LEVEL` 设置过高

**解决**:
```env
LOG_LEVEL=debug
```

### 问题 2: 找不到 logger 模块

**原因**: 导入路径错误

**解决**: 确保使用正确的导入：
```typescript
import { createLogger } from '@/lib/logger';
```

### 问题 3: 生产环境日志过多

**原因**: `LOG_LEVEL` 未设置或设置为 debug

**解决**: 生产环境设置：
```env
LOG_LEVEL=info
```

---

## 输出格式

### JSON 格式

所有日志输出为 JSON 格式，便于日志聚合平台解析：

```json
{
  "level": "info",
  "time": "2025-12-18T14:17:11.410Z",
  "env": "production",
  "module": "auth",
  "email": "user@example.com",
  "msg": "Login successful"
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `level` | 日志级别 (trace/debug/info/warn/error/fatal) |
| `time` | ISO 格式时间戳 |
| `env` | 运行环境 (development/production/test) |
| `module` | 日志模块标识 |
| `msg` | 日志消息 |
| `...` | 其他上下文数据 |

---

## 日志聚合集成

### ELK Stack

```bash
# Logstash 配置
input {
  file {
    path => "/var/log/app/*.log"
    codec => json
  }
}

filter {
  if [module] {
    mutate {
      add_tag => ["structured-log"]
    }
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
  }
}
```

### DataDog

DataDog Agent 自动识别 JSON 日志，可按 `module` 字段分组，按 `level` 字段过滤和告警。

### CloudWatch Logs

AWS CloudWatch Agent 自动解析 JSON 格式，可创建 Metric Filter 和告警。

---

## 前端日志 (Frontend Logger)

用于浏览器端日志，自动批量发送到后端。

### 导入

```typescript
import { frontendLogger } from '@/lib/frontend-logger';
```

### 使用方法

```typescript
// 普通日志
frontendLogger.info('[PageName]', 'Operation completed', { userId: 123 });

// 警告
frontendLogger.warn('[PageName]', 'Slow response detected', { duration: 5000 });

// 错误
frontendLogger.error('[PageName]', 'Failed to load data', { error: err.message });

// 仅 console 输出，不发送到后端
frontendLogger.info('[Debug]', 'Local debug info', {}, { sendToBackend: false });
```

### 批量发送机制

前端日志采用**批量发送**策略，减少网络请求：

| 触发条件 | 说明 |
|---------|------|
| **时间窗口** | 1 秒内的日志合并为一次请求 |
| **缓冲区满** | 累计 20 条日志立即发送 |

### 强制刷新

页面卸载等场景需立即发送日志：

```typescript
// 在 beforeunload 事件中调用
frontendLogger.forceFlush();
```

### 后端接收

日志发送到 `POST /api/logs/frontend`，格式：

```json
{
  "logs": [
    { "level": "info", "prefix": "[Home]", "message": "Page loaded", "timestamp": "..." },
    { "level": "info", "prefix": "[Home]", "message": "Data fetched", "timestamp": "..." }
  ]
}
```

浏览器中未捕获的异常和未处理的 Promise 拒绝由 `installGlobalErrorLogging()`（在 `src/components/providers.tsx` 中注册）以 `[GlobalError]` 前缀上报。

---

## 调试模式与调试日志导出

管理员在「设置 → 用户管理 → 调试日志」中开启调试模式后，`src/lib/debug-log.ts` 会把**所有级别**的服务端日志（不受 `LOG_LEVEL` 限制，包括 `debug`、`trace` 和 `logger.box`）以及经 `/api/logs/frontend` 上报的前端日志写入内存缓冲区，复现问题后可导出 JSON 文件发给作者。

| 接口 | 说明 |
|------|------|
| `GET /api/admin/debug-logs` | 调试模式状态与已记录条数 |
| `POST /api/admin/debug-logs` | `{ "enabled": true/false }` 开启（同时清空上一轮日志）或关闭 |
| `DELETE /api/admin/debug-logs` | 清空已记录的日志 |
| `GET /api/admin/debug-logs/export` | 下载调试日志：运行版本、系统环境、脱敏后的配置和日志条目 |

- **脱敏**：字段名含 API Key、password、secret、authorization、cookie、各类 token（不含 `maxTokens` 等用量字段）的值替换为 `[REDACTED]`；字符串中的 `Bearer` 令牌、`sk-` 开头的 Key、URL 中的 `key` 参数同样替换；图片 data URL 只保留类型和长度；单个字符串最长保留 10000 字符。
- **上限**：最多 5000 条、约 20 MB，超出后丢弃最早的记录；开启 24 小时后自动关闭。
- **存储**：只在服务进程内存中（挂在 `globalThis` 上，各路由共享），服务重启后调试模式关闭、日志清空。

---

**文档更新时间**: 2026-10-31

## 📚 相关文档

- [日志迁移报告](./LOGGING_MIGRATION_FINAL_REPORT.md)
- [项目健康报告](./PROJECT_HEALTH_REPORT.md)

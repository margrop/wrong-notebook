import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { withUser } from '@/lib/api-handler';
import type { AuthenticatedContext } from '@/lib/api-handler';
import { badRequest } from '@/lib/api-errors';
import { frontendLogsSchema, parseFrontendLogEntry } from '@/lib/schemas/logs';

const logger = createLogger('frontend-logs');

// 单次最多接收的日志条数与单条消息长度，防止刷爆日志
const MAX_LOGS_PER_REQUEST = 50;
const MAX_MESSAGE_LENGTH = 2000;

export const runtime = 'nodejs';

/**
 * POST /api/logs/frontend
 *
 * Receives frontend logs and writes them to backend logger
 * Supports both single log and batch log formats.
 */
export const POST = withUser(async (request: Request, { user }: AuthenticatedContext) => {
  try {
    const rawBody: unknown = await request.json().catch(() => null);
    const parsed = frontendLogsSchema.safeParse(rawBody);
    if (!parsed.success) {
      return badRequest('Invalid log payload');
    }

    // 支持批量日志格式 { logs: [...] } 和单条日志格式
    const rawLogs: unknown[] = Array.isArray(parsed.data.logs)
      ? parsed.data.logs
      : [parsed.data];
    const logs = rawLogs.slice(0, MAX_LOGS_PER_REQUEST);

    for (const raw of logs) {
      const entry = parseFrontendLogEntry(raw);
      if (!entry) continue;

      const { level, prefix, context = {}, timestamp, url, userAgent } = entry;
      const message = entry.message.slice(0, MAX_MESSAGE_LENGTH);

      // Build log context
      const logContext = {
        source: 'frontend',
        prefix,
        url: url || request.headers.get('referer'),
        userAgent: userAgent || request.headers.get('user-agent'),
        clientTime: timestamp,
        ...context,
        userId: user.id, // 放在最后，避免被前端传入的 context 覆盖
      };

      // Log to backend using appropriate level
      switch (level) {
        case 'error':
          logger.error(logContext, message);
          break;
        case 'warn':
          logger.warn(logContext, message);
          break;
        case 'info':
        default:
          logger.info(logContext, message);
          break;
      }
    }

    return NextResponse.json({ success: true, count: logs.length });
  } catch (error) {
    logger.error({ error }, 'Failed to process frontend log');
    return NextResponse.json({ success: false }, { status: 500 });
  }
});

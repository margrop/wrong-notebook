/**
 * Lightweight structured logger for Next.js
 *
 * This is a custom implementation that avoids pino's thread-stream
 * which causes bundling issues with Next.js Turbopack.
 *
 * Features:
 * - Structured JSON logging (production)
 * - Pretty formatted output with colors (development)
 * - Configurable log levels via LOG_LEVEL env var
 * - Module-based child loggers
 * - 管理员开启调试模式后，所有级别的日志额外写入调试日志缓冲区（见 debug-log.ts）
 *
 * Usage:
 *   logger.info({ userId: 123 }, 'User logged in');
 *   logger.error({ error }, 'Failed to process request');
 *   logger.debug({ data }, 'Debug information');
 */

import { recordDebugLog } from './debug-log';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

// ANSI color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  // Level colors
  trace: '\x1b[90m',   // gray
  debug: '\x1b[36m',   // cyan
  info: '\x1b[32m',    // green
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
  fatal: '\x1b[35m',   // magenta
  // Context colors
  module: '\x1b[34m',  // blue
  value: '\x1b[37m',   // white
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
  fatal: 'FATAL',
};

function getLogLevel(): number {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    return LOG_LEVELS[envLevel];
  }
  return process.env.NODE_ENV === 'production' ? LOG_LEVELS.info : LOG_LEVELS.debug;
}

const isPrettyMode = process.env.NODE_ENV !== 'production';

interface LogContext {
  [key: string]: unknown;
}

interface Logger {
  trace: (ctx: LogContext | string, msg?: string) => void;
  debug: (ctx: LogContext | string, msg?: string) => void;
  info: (ctx: LogContext | string, msg?: string) => void;
  warn: (ctx: LogContext | string, msg?: string) => void;
  error: (ctx: LogContext | string, msg?: string) => void;
  fatal: (ctx: LogContext | string, msg?: string) => void;
  child: (bindings: LogContext) => Logger;
  // Decorative logging for development
  box: (title: string, content?: string | LogContext, emoji?: string) => void;
  divider: (char?: string) => void;
}

function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    return value; // No quotes, no truncation for full readability
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2); // Pretty print objects
  }
  return String(value);
}

function formatPrettyLog(
  level: LogLevel,
  timestamp: Date,
  baseContext: LogContext,
  context: LogContext,
  message: string
): string {
  const time = formatTime(timestamp);
  const levelColor = COLORS[level];
  const levelLabel = LEVEL_LABELS[level];

  // Extract module from context
  const moduleName = baseContext.module || context.module || '';

  // Merge and filter context (exclude env, module which are shown separately)
  const mergedContext = { ...baseContext, ...context };
  delete mergedContext.env;
  delete mergedContext.module;

  // Build the main line
  let output = `${COLORS.dim}[${time}]${COLORS.reset} ${levelColor}${levelLabel}${COLORS.reset}`;

  if (moduleName) {
    output += ` ${COLORS.module}(${moduleName})${COLORS.reset}`;
  }

  output += `: ${message}`;

  // Add context on new lines if there's any
  const contextKeys = Object.keys(mergedContext);
  if (contextKeys.length > 0) {
    for (const key of contextKeys) {
      const value = mergedContext[key];
      const formattedValue = formatValue(value);
      output += `\n    ${COLORS.dim}${key}:${COLORS.reset} ${COLORS.value}${formattedValue}${COLORS.reset}`;
    }
  }

  return output;
}

function createLogFunction(level: LogLevel, baseContext: LogContext = {}): (ctx: LogContext | string, msg?: string) => void {
  const levelNum = LOG_LEVELS[level];
  const currentLevel = getLogLevel();

  return (ctx: LogContext | string, msg?: string) => {
    const timestamp = new Date();
    let context: LogContext;
    let message: string;

    if (typeof ctx === 'string') {
      context = {};
      message = ctx;
    } else {
      context = ctx;
      message = msg || '';
    }

    // 调试模式下不受 LOG_LEVEL 限制，debug、trace 级别也记录
    recordDebugLog(level, { ...baseContext, ...context }, message, timestamp);

    if (levelNum < currentLevel) return;

    if (isPrettyMode) {
      // Pretty formatted output for development
      const output = formatPrettyLog(level, timestamp, baseContext, context, message);

      switch (level) {
        case 'error':
        case 'fatal':
          console.error(output);
          break;
        case 'warn':
          console.warn(output);
          break;
        default:
          console.log(output);
      }
    } else {
      // JSON output for production
      const logEntry = {
        level,
        time: timestamp.toISOString(),
        ...baseContext,
        ...context,
        msg: message,
      };

      const output = JSON.stringify(logEntry);

      switch (level) {
        case 'error':
        case 'fatal':
          console.error(output);
          break;
        case 'warn':
          console.warn(output);
          break;
        default:
          console.log(output);
      }
    }
  };
}

function createLoggerInstance(baseContext: LogContext = {}): Logger {
  const moduleName = baseContext.module || '';
  const moduleTag = moduleName ? `[${moduleName}]` : '';

  return {
    trace: createLogFunction('trace', baseContext),
    debug: createLogFunction('debug', baseContext),
    info: createLogFunction('info', baseContext),
    warn: createLogFunction('warn', baseContext),
    error: createLogFunction('error', baseContext),
    fatal: createLogFunction('fatal', baseContext),
    child: (bindings: LogContext) => createLoggerInstance({ ...baseContext, ...bindings }),

    // Decorative box logging (only in development)
    box: (title: string, content?: string | LogContext, emoji: string = '📋') => {
      recordDebugLog('info', { ...baseContext, ...(typeof content === 'string' ? { content } : content) }, title);

      if (!isPrettyMode) {
        // In production, just log as JSON
        const ctx = typeof content === 'string' ? { content } : (content || {});
        console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), ...baseContext, title, ...ctx, msg: title }));
        return;
      }

      const width = 80;
      const line = '='.repeat(width);
      const thinLine = '-'.repeat(width);

      console.log('');
      console.log(`${COLORS.info}${line}${COLORS.reset}`);
      console.log(`${COLORS.module}${moduleTag}${COLORS.reset} ${emoji} ${COLORS.bold}${title}${COLORS.reset}`);
      console.log(`${COLORS.info}${line}${COLORS.reset}`);

      if (content) {
        if (typeof content === 'string') {
          // Multi-line string content
          console.log(content);
        } else {
          // Object content - pretty print each key
          for (const [key, value] of Object.entries(content)) {
            const formattedValue = typeof value === 'string'
              ? value
              : JSON.stringify(value, null, 2);
            console.log(`${COLORS.dim}${key}:${COLORS.reset} ${formattedValue}`);
          }
        }
        console.log(`${COLORS.info}${thinLine}${COLORS.reset}`);
      }
    },

    // Print a divider line
    divider: (char: string = '-') => {
      if (!isPrettyMode) return;
      console.log(`${COLORS.dim}${char.repeat(80)}${COLORS.reset}`);
    },
  };
}

export const logger = createLoggerInstance({ env: process.env.NODE_ENV });

/**
 * Create a child logger with additional context
 *
 * Usage:
 *   const apiLogger = createLogger('api');
 *   apiLogger.info({ route: '/analyze' }, 'API called');
 */
export function createLogger(module: string): Logger {
  return logger.child({ module });
}

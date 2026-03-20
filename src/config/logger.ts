export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogEntry = {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  [key: string]: unknown;
};

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatEntry(entry: LogEntry): string {
  const { timestamp, level, module, message, ...extra } = entry;
  const extraStr = Object.keys(extra).length > 0 ? ' ' + JSON.stringify(extra) : '';
  return `${timestamp} [${level.toUpperCase().padEnd(5)}] [${module}] ${message}${extraStr}`;
}

export function createLogger(module: string) {
  function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      ...meta,
    };

    const formatted = formatEntry(entry);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'debug':
        console.debug(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  return {
    debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;

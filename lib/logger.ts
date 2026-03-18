type LogContext = Record<string, unknown>;

function formatContext(context?: LogContext): string {
  if (!context) {
    return "";
  }

  try {
    return ` ${JSON.stringify(context)}`;
  } catch {
    return " [unserializable-context]";
  }
}

function now(): string {
  return new Date().toISOString();
}

export const logger = {
  info(message: string, context?: LogContext): void {
    console.info(`[${now()}] INFO ${message}${formatContext(context)}`);
  },
  warn(message: string, context?: LogContext): void {
    console.warn(`[${now()}] WARN ${message}${formatContext(context)}`);
  },
  error(message: string, context?: LogContext): void {
    console.error(`[${now()}] ERROR ${message}${formatContext(context)}`);
  },
};

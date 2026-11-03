import pino, { type Logger } from 'pino';

export interface CreateLoggerOptions {
  service: string;
  level: string;
}

export function createLogger({ service, level }: CreateLoggerOptions): Logger {
  return pino({
    name: service,
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.accessToken',
        '*.secret',
      ],
      censor: '[redacted]',
    },
  });
}

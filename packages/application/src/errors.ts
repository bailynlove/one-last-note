export interface AppErrorOptions {
  status?: number;
  title?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly title: string;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.status = options.status ?? 500;
    this.title = options.title ?? 'Internal Server Error';
  }
}

import type { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger';

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<any> | any;

/**
 * AppError: consistent error type used across services/routes
 */
export class AppError extends Error {
  statusCode: number;
  errors?: any[];

  constructor(message: string, statusCode = 500, errors?: any[]) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const asyncHandler =
  (fn: AsyncFn) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  // express-validator style
  const validationErrors = err?.errors;
  if (Array.isArray(validationErrors) && validationErrors.length > 0) {
    return res.status(400).json({ errors: validationErrors });
  }

  const statusCode = Number(err?.statusCode || err?.status || 500);
  const message = err?.message || 'Internal Server Error';

  // Full detail goes to the server logs (where it belongs), never the response.
  if (statusCode >= 500) {
    Logger.error(`[errorHandler] ${statusCode} ${message}`, err?.stack || err);
  }

  // Do not disclose internals in the HTTP response by default. Stacks are logged,
  // not returned; 5xx messages are generic unless EXPOSE_ERROR_STACK is explicitly
  // set (local debugging only). 4xx messages stay informative for the client.
  const exposeStack = process.env.EXPOSE_ERROR_STACK === 'true';
  const safeMessage = statusCode >= 500 && !exposeStack ? 'Internal Server Error' : message;

  return res.status(statusCode).json({
    message: safeMessage,
    statusCode,
    ...(err?.errors ? { errors: err.errors } : {}),
    ...(exposeStack ? { stack: err?.stack } : {}),
  });
};

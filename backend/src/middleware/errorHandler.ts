import type { Request, Response, NextFunction } from 'express';

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

  const isProd = process.env.NODE_ENV === 'production';

  // avoid crashing inside error handler
  if (!isProd) {
    return res.status(statusCode).json({
      message,
      statusCode,
      stack: err?.stack,
      errors: err?.errors,
    });
  }

  return res.status(statusCode).json({ message, statusCode });
};

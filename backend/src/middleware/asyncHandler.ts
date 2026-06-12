import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Wrap async route handlers so errors go to Express error middleware
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export default asyncHandler;

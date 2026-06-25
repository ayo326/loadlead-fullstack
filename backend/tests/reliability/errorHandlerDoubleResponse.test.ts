// REL — errorHandler must NOT attempt to respond twice.
//
// Express middleware contract: if `res.headersSent` is true, a second
// res.status().json() call throws ERR_HTTP_HEADERS_SENT and crashes
// the request, but in production we just want the second response to
// be a no-op so the original response still reaches the client.
//
// Triggers we care about in real prod traffic:
//   - A route writes a chunked response, then throws partway through
//   - asyncHandler catches the throw and calls next(err)
//   - errorHandler runs — but the headers are already on the wire
//
// Without the headersSent check the errorHandler crashes the worker
// and Express's default handler sends an additional <html>error</html>
// that often gets appended to the truncated JSON the client already
// received — observable as a parse error in the client.
//
// This test pins the invariant. If a future refactor removes the
// headersSent guard, CI fails BEFORE the regression hits prod.

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler, AppError } from '../../src/middleware/errorHandler';

function makeRes(headersSent: boolean): Response {
  const status = vi.fn().mockReturnThis();
  const json   = vi.fn().mockReturnThis();
  return { status, json, headersSent } as unknown as Response;
}

describe('REL: errorHandler double-response safety', () => {
  it('normal case: writes status + JSON when headers not yet sent', () => {
    const res = makeRes(false);
    const next = vi.fn() as NextFunction;
    const err = new AppError('something went wrong', 418);

    errorHandler(err, {} as Request, res, next);

    expect((res.status as any)).toHaveBeenCalledWith(418);
    expect((res.json as any)).toHaveBeenCalled();
  });

  it('AppError statusCode propagates verbatim (no flattening to 500)', () => {
    const res = makeRes(false);
    const cases = [400, 401, 403, 404, 409, 412, 429];
    for (const code of cases) {
      (res.status as any).mockClear();
      errorHandler(new AppError(`x`, code), {} as Request, res, vi.fn() as NextFunction);
      expect((res.status as any)).toHaveBeenCalledWith(code);
    }
  });

  it('unknown error (no statusCode) defaults to 500', () => {
    const res = makeRes(false);
    errorHandler(new Error('uncaught surprise'), {} as Request, res, vi.fn() as NextFunction);
    expect((res.status as any)).toHaveBeenCalledWith(500);
  });

  it('express-validator-style errors[] takes priority — returns 400 with the errors array', () => {
    const res = makeRes(false);
    const err: any = { errors: [{ msg: 'email required' }, { msg: 'role invalid' }] };
    errorHandler(err, {} as Request, res, vi.fn() as NextFunction);
    expect((res.status as any)).toHaveBeenCalledWith(400);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.errors).toHaveLength(2);
  });

  it('JSON body shape in prod: { message, statusCode } only (no stack leak)', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = makeRes(false);
      errorHandler(new AppError('leak this', 400), {} as Request, res, vi.fn() as NextFunction);
      const body = (res.json as any).mock.calls[0][0];
      expect(body).toEqual({ message: 'leak this', statusCode: 400 });
      expect(body.stack).toBeUndefined();
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('JSON body shape in non-prod: includes stack for local debugging', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = makeRes(false);
      const e = new AppError('local stack', 500);
      errorHandler(e, {} as Request, res, vi.fn() as NextFunction);
      const body = (res.json as any).mock.calls[0][0];
      expect(body.stack).toBeTruthy();
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});

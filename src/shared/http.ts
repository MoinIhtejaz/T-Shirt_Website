// Orchestrator-owned glue. Error envelope helpers from contracts/errors.md.
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import type { ApiError, ErrorCode, FieldError } from '../../contracts/types';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: FieldError[],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: FieldError[],
): void {
  const body: ApiError = { error: details ? { code, message, details } : { code, message } };
  res.status(status).json(body);
}

/** Final 404 for unmatched /api routes. */
export const apiNotFound: RequestHandler = (_req, res) => {
  sendError(res, 404, 'NOT_FOUND', 'Not found.');
};

/** Last middleware in the app. Express 5 forwards rejected async handlers here. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    return sendError(res, err.status, err.code, err.message, err.details);
  }
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'The request body is not valid JSON.');
  }
  if (type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
  }
  // Other client errors raised by Express itself, e.g. URIError (status 400) from a path
  // parameter with malformed percent-encoding. They are the caller's fault, not ours.
  const status = (err as { status?: unknown; statusCode?: unknown } | null)?.status
    ?? (err as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    if (status === 404) return sendError(res, 404, 'NOT_FOUND', 'Not found.');
    return sendError(res, 400, 'VALIDATION_FAILED', 'The request is malformed.');
  }
  console.error('[unhandled]', err);
  sendError(res, 500, 'INTERNAL', 'Something went wrong.');
};

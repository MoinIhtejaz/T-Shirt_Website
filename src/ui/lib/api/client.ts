import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../../../../contracts/types';
import type { ApiError, ErrorCode, FieldError } from '../../../../contracts/types';

/** Codes the client adds on top of the server's ErrorCode set. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'BAD_RESPONSE';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: FieldError[];
  /** Seconds from a Retry-After header, when the server sent one. */
  readonly retryAfter: number | null;

  constructor(init: {
    status: number;
    code: ClientErrorCode;
    message: string;
    details?: FieldError[];
    retryAfter?: number | null;
  }) {
    super(init.message);
    this.name = 'ApiClientError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.retryAfter = init.retryAfter ?? null;
  }
}

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError;
}

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  /** JSON-serialisable body. Ignored when `formData` is given. */
  body?: unknown;
  /** Multipart body. The browser sets the boundary header itself. */
  formData?: FormData;
  signal?: AbortSignal;
}

const FALLBACK_MESSAGES: Record<number, string> = {
  400: 'The request was not accepted. Check the form and try again.',
  401: 'You need to log in again.',
  403: 'The server refused that request.',
  404: 'That page or item could not be found.',
  409: 'That clashes with something that already exists.',
  413: 'That file is too large. The limit is 5 MB.',
  415: 'That file type is not supported. Use JPEG, PNG or WebP.',
  429: 'Too many attempts. Wait a moment and try again.',
};

function fallbackMessage(status: number): string {
  return FALLBACK_MESSAGES[status] ?? 'Something went wrong on the server. Try again in a moment.';
}

function isFieldError(value: unknown): value is FieldError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FieldError).field === 'string' &&
    typeof (value as FieldError).message === 'string'
  );
}

function isApiErrorBody(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as ApiError).error;
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof err.code === 'string' &&
    typeof err.message === 'string'
  );
}

function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get('Retry-After');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

async function readJson(res: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false };
  }
  if (text.trim() === '') return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Calls the site API. Resolves with the parsed JSON body (or undefined for 204),
 * and rejects with ApiClientError for every failure: non-2xx, network, or unreadable body.
 * Abort errors from `signal` are re-thrown untouched so callers can ignore them.
 */
export async function apiRequest<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  let body: BodyInit | undefined;

  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiClientError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  if (res.status === 204) return undefined as T;

  const parsed = await readJson(res);

  if (res.ok) {
    if (!parsed.ok) {
      throw new ApiClientError({
        status: res.status,
        code: 'BAD_RESPONSE',
        message: 'The server sent a response the site could not read. Try again in a moment.',
      });
    }
    return parsed.value as T;
  }

  if (parsed.ok && isApiErrorBody(parsed.value)) {
    const { code, message, details } = parsed.value.error;
    throw new ApiClientError({
      status: res.status,
      code: code as ErrorCode,
      message,
      details: Array.isArray(details) ? details.filter(isFieldError) : [],
      retryAfter: parseRetryAfter(res),
    });
  }

  throw new ApiClientError({
    status: res.status,
    code: 'BAD_RESPONSE',
    message: fallbackMessage(res.status),
    retryAfter: parseRetryAfter(res),
  });
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

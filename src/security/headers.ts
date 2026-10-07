// Security layer: response headers and CSRF guard (SEC-002).
import type { RequestHandler } from 'express';
import type { AppConfig } from '../shared/config';
import { sendError } from '../shared/http';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../../contracts/types';

const BASE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * `servedOverHttps` is config.cookieSecure, the same switch that turns on HSTS.
 * upgrade-insecure-requests must follow HTTPS, not NODE_ENV: on a plain-HTTP
 * host the browser would rewrite every asset and API call to https:// and the
 * page would load blank (DEF-001).
 */
export function buildCsp(servedOverHttps: boolean): string {
  return servedOverHttps ? `${BASE_CSP}; upgrade-insecure-requests` : BASE_CSP;
}

/**
 * Sets the baseline security headers on every response. It runs first, so a
 * later handler (the /uploads sandbox in src/app.ts) can replace the CSP with
 * a stricter one by calling res.setHeader again.
 */
export function securityHeaders(config: AppConfig): RequestHandler {
  const headers: Array<[string, string]> = [
    ['Content-Security-Policy', buildCsp(config.cookieSecure)],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ];
  if (config.cookieSecure) {
    headers.push(['Strict-Transport-Security', 'max-age=15552000; includeSubDomains']);
  }
  return (_req, res, next) => {
    for (const [name, value] of headers) res.setHeader(name, value);
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * contracts/auth.md#CSRF. Any state-changing request must carry
 * X-Saltline-CSRF: 1. A cross-origin page can't add a custom header without a
 * CORS preflight, and the server enables no CORS.
 */
export function csrfGuard(): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.get(CSRF_HEADER) === CSRF_HEADER_VALUE) return next();
    sendError(res, 403, 'CSRF_REJECTED', 'This request was blocked. Reload the page and try again.');
  };
}

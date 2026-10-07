// Security layer: in-memory fixed-window rate limiter (SEC-003).
// Accepted risk (docs/threat-model.md): counters live in process memory, so a
// restart resets them and several processes don't share them.
import type { RequestHandler } from 'express';
import type { RateLimitOptions } from '../../contracts/modules';
import { sendError } from '../shared/http';

/** Hard ceiling on tracked clients, on top of the per-window sweep. */
export const MAX_BUCKETS = 50_000;

interface Bucket {
  count: number;
  resetAt: number; // epoch ms when this window ends
}

export interface HitResult {
  allowed: boolean;
  /** Whole seconds until the window resets (at least 1). */
  retryAfterSeconds: number;
}

export interface FixedWindowCounter {
  hit(key: string, now: number): HitResult;
  /** Number of buckets currently held. Exposed for tests. */
  size(): number;
}

function assertPositiveInt(value: unknown, name: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`rateLimiter: ${name} must be a positive integer`);
  }
}

export function createFixedWindowCounter(
  { windowMs, max }: RateLimitOptions,
  maxBuckets: number = MAX_BUCKETS,
): FixedWindowCounter {
  assertPositiveInt(windowMs, 'windowMs');
  assertPositiveInt(max, 'max');
  assertPositiveInt(maxBuckets, 'maxBuckets');

  const buckets = new Map<string, Bucket>();
  let nextSweepAt = 0;

  function sweep(now: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    nextSweepAt = now + windowMs;
  }

  return {
    hit(key, now) {
      if (now >= nextSweepAt) sweep(now);

      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        if (bucket) buckets.delete(key);
        if (buckets.size >= maxBuckets) {
          sweep(now);
          // Still full: drop the oldest entry (Map keeps insertion order).
          while (buckets.size >= maxBuckets) {
            const oldest = buckets.keys().next().value as string;
            buckets.delete(oldest);
          }
        }
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }

      if (bucket.count < max) {
        bucket.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    },
    size() {
      return buckets.size;
    },
  };
}

/** Per-IP fixed window. Each call returns an independent limiter with its own counters. */
export function rateLimiter(options: RateLimitOptions): RequestHandler {
  const counter = createFixedWindowCounter(options);
  return (req, res, next) => {
    const key = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const result = counter.hit(key, Date.now());
    if (result.allowed) return next();
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    sendError(res, 429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.');
  };
}

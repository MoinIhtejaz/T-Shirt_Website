import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rateLimiter } from '../../src/security/index';
import { createFixedWindowCounter } from '../../src/security/rateLimit';
import { errorHandler } from '../../src/shared/http';

function limitedApp(options: { windowMs: number; max: number }, trustProxy = false) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.post('/login', rateLimiter(options), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

const T0 = new Date('2026-10-06T00:00:00.000Z');

beforeEach(() => {
  // Fake only Date, so supertest's sockets and timers keep working.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

describe('rateLimiter', () => {
  it('allows max requests, then gives 429 RATE_LIMITED with Retry-After', async () => {
    const app = limitedApp({ windowMs: 15 * 60 * 1000, max: 3 });
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post('/login');
      expect(ok.status).toBe(200);
      expect(ok.headers['retry-after']).toBeUndefined();
    }
    const blocked = await request(app).post('/login');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: 'RATE_LIMITED', message: expect.any(String) } });
    expect(blocked.headers['retry-after']).toBe(String(15 * 60));
  });

  it('reports Retry-After in whole seconds, rounded up', async () => {
    const app = limitedApp({ windowMs: 10_000, max: 1 });
    await request(app).post('/login');
    advance(2_500);
    const blocked = await request(app).post('/login');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('8'); // 7.5 s left -> 8
    expect(blocked.headers['retry-after']).toMatch(/^\d+$/);
  });

  it('keeps blocking for the rest of the window, then resets', async () => {
    const app = limitedApp({ windowMs: 60_000, max: 2 });
    await request(app).post('/login');
    await request(app).post('/login');
    advance(30_000);
    expect((await request(app).post('/login')).status).toBe(429);
    advance(29_999);
    const last = await request(app).post('/login');
    expect(last.status).toBe(429);
    expect(last.headers['retry-after']).toBe('1');
    advance(1);
    expect((await request(app).post('/login')).status).toBe(200);
    expect((await request(app).post('/login')).status).toBe(200);
    expect((await request(app).post('/login')).status).toBe(429);
  });

  it('keys by client IP', async () => {
    const app = limitedApp({ windowMs: 60_000, max: 1 }, true);
    expect((await request(app).post('/login').set('X-Forwarded-For', '203.0.113.1')).status).toBe(200);
    expect((await request(app).post('/login').set('X-Forwarded-For', '203.0.113.1')).status).toBe(429);
    expect((await request(app).post('/login').set('X-Forwarded-For', '203.0.113.2')).status).toBe(200);
  });

  it('creates an independent limiter on each call', async () => {
    const app = express();
    app.post('/a', rateLimiter({ windowMs: 60_000, max: 1 }), (_req, res) => {
      res.sendStatus(200);
    });
    app.post('/b', rateLimiter({ windowMs: 60_000, max: 1 }), (_req, res) => {
      res.sendStatus(200);
    });
    app.use(errorHandler);
    expect((await request(app).post('/a')).status).toBe(200);
    expect((await request(app).post('/a')).status).toBe(429);
    expect((await request(app).post('/b')).status).toBe(200);
  });

  it('rejects invalid options at construction time', () => {
    expect(() => rateLimiter({ windowMs: 0, max: 1 })).toThrow(TypeError);
    expect(() => rateLimiter({ windowMs: 1000, max: 0 })).toThrow(TypeError);
    expect(() => rateLimiter({ windowMs: Number.NaN, max: 1 })).toThrow(TypeError);
    expect(() => rateLimiter({ windowMs: 1000, max: 1.5 })).toThrow(TypeError);
  });
});

describe('fixed window counter memory', () => {
  it('prunes expired buckets once a window has passed', () => {
    const counter = createFixedWindowCounter({ windowMs: 1000, max: 5 });
    const now = 1_000_000;
    for (let i = 0; i < 500; i++) counter.hit(`10.0.${Math.floor(i / 256)}.${i % 256}`, now);
    expect(counter.size()).toBe(500);
    counter.hit('192.0.2.1', now + 1000);
    expect(counter.size()).toBe(1);
  });

  it('never holds more than maxBuckets entries', () => {
    const counter = createFixedWindowCounter({ windowMs: 60_000, max: 5 }, 100);
    for (let i = 0; i < 1000; i++) counter.hit(`key-${i}`, 5_000 + i);
    expect(counter.size()).toBeLessThanOrEqual(100);
  });

  it('still limits a client whose bucket survives', () => {
    const counter = createFixedWindowCounter({ windowMs: 60_000, max: 2 }, 100);
    expect(counter.hit('a', 0).allowed).toBe(true);
    expect(counter.hit('a', 1).allowed).toBe(true);
    const third = counter.hit('a', 2);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(60);
  });
});

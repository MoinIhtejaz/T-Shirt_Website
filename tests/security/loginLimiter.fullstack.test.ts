// SEC-004: the login rate limiter as mounted by src/app.ts (10 attempts per 15 minutes per IP).
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, CSRF, makeSecApp, type SecApp } from './fullstack';

describe('SEC-004 login limiter on the real app', () => {
  let t: SecApp | undefined;
  afterEach(() => {
    t?.cleanup();
    t = undefined;
  });

  const attempt = (app: SecApp['app'], password = 'wrong-password-guess', path = '/api/auth/login') =>
    request(app).post(path).set(CSRF).send({ email: ADMIN_EMAIL, password });

  it('the 11th attempt is 429 RATE_LIMITED with Retry-After, even with the right password', async () => {
    t = await makeSecApp();
    for (let i = 1; i <= 10; i++) {
      const res = await attempt(t.app);
      expect(res.status, `attempt ${i}`).toBe(401);
    }
    const blocked = await attempt(t.app, ADMIN_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    const retry = Number(blocked.headers['retry-after']);
    expect(Number.isInteger(retry)).toBe(true);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(15 * 60);
    // The limiter runs before the auth router: no cookie and no session were issued.
    expect(blocked.headers['set-cookie']).toBeUndefined();
    const row = t.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    expect(row.n).toBe(0);
  });

  it('successful logins count too, so a correct password cannot be used to probe past the limit', async () => {
    t = await makeSecApp();
    for (let i = 1; i <= 10; i++) expect((await attempt(t.app, ADMIN_PASSWORD)).status).toBe(200);
    expect((await attempt(t.app, ADMIN_PASSWORD)).status).toBe(429);
  });

  it('spoofed X-Forwarded-For headers do not get a fresh budget (trust proxy is off)', async () => {
    t = await makeSecApp();
    for (let i = 1; i <= 10; i++) {
      await attempt(t.app).set('X-Forwarded-For', `203.0.113.${i}`);
    }
    const res = await attempt(t.app).set('X-Forwarded-For', '198.51.100.77').set('X-Real-IP', '198.51.100.78');
    expect(res.status).toBe(429);
  });

  it('path variants that still reach the login handler share the same bucket', async () => {
    t = await makeSecApp();
    const variants = ['/api/auth/login', '/api/auth/login/', '/API/AUTH/LOGIN', '/api/auth/Login'];
    for (let i = 0; i < 10; i++) {
      const res = await attempt(t.app, 'wrong-password-guess', variants[i % variants.length]);
      expect(res.status, variants[i % variants.length]).toBe(401);
    }
    for (const path of variants) {
      expect((await attempt(t.app, ADMIN_PASSWORD, path)).status, path).toBe(429);
    }
  });

  it('requests rejected by the CSRF guard or the validator do not open a side door', async () => {
    t = await makeSecApp();
    for (let i = 0; i < 10; i++) await attempt(t.app);
    // Without the CSRF header the guard answers first (403), which is still a refusal.
    const noCsrf = await request(t.app).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(noCsrf.status).toBe(403);
    // Malformed bodies are counted and limited too.
    const malformed = await request(t.app).post('/api/auth/login').set(CSRF).send({ email: [ADMIN_EMAIL] });
    expect(malformed.status).toBe(429);
  });

  it('other routes are not throttled by the login limiter', async () => {
    t = await makeSecApp();
    for (let i = 0; i < 11; i++) await attempt(t.app);
    expect((await request(t.app).get('/api/health')).status).toBe(200);
    expect((await request(t.app).post('/api/auth/logout').set(CSRF)).status).toBe(204);
  });
});

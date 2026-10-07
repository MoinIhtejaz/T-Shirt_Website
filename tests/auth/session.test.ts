// AUTH-002: session issue, lookup, expiry and requireAdmin middleware.
import crypto from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, cookieHeader, makeHarness, tokenFrom, type Harness } from './helpers';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const CSRF = { 'X-Saltline-CSRF': '1' };

async function login(h: Harness) {
  const res = await request(h.app)
    .post('/api/auth/login')
    .set(CSRF)
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  expect(res.status).toBe(200);
  return { res, token: tokenFrom(res) };
}

describe('session issue and storage', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it('issues a 32-byte base64url token and stores only its hex sha256', async () => {
    const { token } = await login(h);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);

    expect(h.sessions.rows.size).toBe(1);
    const [storedHash, record] = [...h.sessions.rows.entries()][0];
    expect(storedHash).toBe(sha256(token));
    expect(record.tokenHash).toBe(sha256(token));
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedHash).not.toBe(token);
    expect(JSON.stringify([...h.sessions.rows.values()])).not.toContain(token);
    expect(record.adminId).toBe(h.adminId);
  });

  it('sets a fixed expiry of sessionTtlHours from creation', async () => {
    const before = Date.now();
    await login(h);
    const after = Date.now();
    const record = [...h.sessions.rows.values()][0];
    const ttlMs = h.config.sessionTtlHours * 3600 * 1000;
    expect(record.expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttlMs);
    expect(record.expiresAt.getTime()).toBeLessThanOrEqual(after + ttlMs);
  });

  it('does not slide the expiry on use', async () => {
    const { token } = await login(h);
    const original = [...h.sessions.rows.values()][0].expiresAt.getTime();
    await request(h.app).get('/api/admin/ping').set('Cookie', cookieHeader(token)).expect(200);
    await request(h.app).get('/api/auth/me').set('Cookie', cookieHeader(token)).expect(200);
    expect([...h.sessions.rows.values()][0].expiresAt.getTime()).toBe(original);
  });

  it('honours a custom TTL from config', async () => {
    const h2 = await makeHarness({ sessionTtlHours: 1 });
    const before = Date.now();
    await login(h2);
    const record = [...h2.sessions.rows.values()][0];
    expect(record.expiresAt.getTime() - before).toBeGreaterThanOrEqual(3600 * 1000 - 50);
    expect(record.expiresAt.getTime() - before).toBeLessThanOrEqual(3600 * 1000 + 1000);
  });
});

describe('requireAdmin', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it('sets req.admin for a valid session', async () => {
    const { token } = await login(h);
    const res = await request(h.app).get('/api/admin/ping').set('Cookie', cookieHeader(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ admin: { id: h.adminId, email: ADMIN_EMAIL } });
    expect(res.body.admin).not.toHaveProperty('passwordHash');
  });

  it('returns JSON 401 UNAUTHENTICATED without a cookie, and never redirects', async () => {
    const res = await request(h.app).get('/api/admin/ping');
    expect(res.status).toBe(401);
    expect(res.headers['location']).toBeUndefined();
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error).not.toHaveProperty('details');
  });

  it('returns 401 for an unknown or tampered token', async () => {
    const { token } = await login(h);
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    for (const value of [tampered, 'garbage', sha256(token)]) {
      const res = await request(h.app).get('/api/admin/ping').set('Cookie', cookieHeader(value));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects the stored hash used as a cookie value (raw token is required)', async () => {
    const { token } = await login(h);
    const res = await request(h.app).get('/api/admin/ping').set('Cookie', cookieHeader(sha256(token)));
    expect(res.status).toBe(401);
  });

  it('expired session gives 401 UNAUTHENTICATED and the row is deleted', async () => {
    const { token } = await login(h);
    const hash = sha256(token);
    h.sessions.rows.get(hash)!.expiresAt = new Date(Date.now() - 1000);

    const res = await request(h.app).get('/api/admin/ping').set('Cookie', cookieHeader(token));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(h.sessions.rows.has(hash)).toBe(false);
  });

  it('treats a session expiring exactly now as expired', async () => {
    const { token } = await login(h);
    const hash = sha256(token);
    h.sessions.rows.get(hash)!.expiresAt = new Date(Date.now());
    const res = await request(h.app).get('/api/auth/me').set('Cookie', cookieHeader(token));
    expect(res.status).toBe(401);
    expect(h.sessions.rows.has(hash)).toBe(false);
  });

  it('returns 401 and drops the session when the admin no longer exists', async () => {
    const { token } = await login(h);
    h.admins.remove(h.adminId);
    const res = await request(h.app).get('/api/admin/ping').set('Cookie', cookieHeader(token));
    expect(res.status).toBe(401);
    expect(h.sessions.rows.size).toBe(0);
  });
});

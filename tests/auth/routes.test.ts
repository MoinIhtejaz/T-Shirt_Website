// AUTH-003: login, logout and me routes.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  cookieHeader,
  makeHarness,
  sessionSetCookie,
  tokenFrom,
  type Harness,
} from './helpers';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const CSRF = { 'X-Saltline-CSRF': '1' };

function attrs(setCookie: string): string[] {
  return setCookie.split(';').map((s) => s.trim());
}

describe('POST /api/auth/login', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('correct credentials give 200, SessionResponse and a Set-Cookie with HttpOnly and SameSite=Strict', async () => {
    const res = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: h.adminId, email: ADMIN_EMAIL } });
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|passwordHash/);

    const cookie = sessionSetCookie(res);
    expect(cookie).toBeDefined();
    const a = attrs(cookie!);
    expect(a).toContain('HttpOnly');
    expect(a).toContain('SameSite=Strict');
    expect(a).toContain('Path=/');
    expect(a).toContain(`Max-Age=${h.config.sessionTtlHours * 3600}`);
    expect(a).not.toContain('Secure');
  });

  it('adds Secure only when config.cookieSecure is true', async () => {
    const hs = await makeHarness({ cookieSecure: true, sessionTtlHours: 2 });
    const res = await request(hs.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    const a = attrs(sessionSetCookie(res)!);
    expect(a).toContain('Secure');
    expect(a).toContain('HttpOnly');
    expect(a).toContain('SameSite=Strict');
    expect(a).toContain('Max-Age=7200');
  });

  it('the stored token hash differs from the cookie value', async () => {
    const res = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const token = tokenFrom(res);
    const stored = [...h.sessions.rows.keys()];
    expect(stored).toEqual([sha256(token)]);
    expect(stored).not.toContain(token);
  });

  it('email is case-insensitive and trimmed', async () => {
    const res = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: `   ${ADMIN_EMAIL.toUpperCase()}  `, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(h.adminId);
  });

  it('wrong password and unknown email return the identical 401 body', async () => {
    const wrong = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: ADMIN_EMAIL, password: 'not the password' });
    const unknown = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'nobody@saltline.test', password: 'not the password' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
    });
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.text).toBe(wrong.text);
    expect(sessionSetCookie(wrong)).toBeUndefined();
    expect(sessionSetCookie(unknown)).toBeUndefined();
    expect(h.sessions.rows.size).toBe(0);
  });

  it('runs one scrypt verification even for an unknown email (timing equalisation)', async () => {
    const spy = vi.spyOn(crypto, 'scrypt');
    await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'nobody@saltline.test', password: 'whatever' })
      .expect(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: ADMIN_EMAIL, password: 'whatever' })
      .expect(401);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns 401 (not 500) when the stored hash is malformed', async () => {
    h.admins.rows[0].passwordHash = 'corrupt';
    const res = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it.each([
    ['missing body', undefined, ['email', 'password']],
    ['empty object', {}, ['email', 'password']],
    ['non-string email', { email: 42, password: 'x' }, ['email']],
    ['non-string password', { email: ADMIN_EMAIL, password: ['x'] }, ['password']],
    ['empty email', { email: '', password: 'x' }, ['email']],
    ['whitespace email', { email: '   ', password: 'x' }, ['email']],
    ['empty password', { email: ADMIN_EMAIL, password: '' }, ['password']],
    ['email over 254 chars', { email: `${'a'.repeat(250)}@x.io`, password: 'x' }, ['email']],
    ['password over 200 chars', { email: ADMIN_EMAIL, password: 'p'.repeat(201) }, ['password']],
  ])('400 VALIDATION_FAILED with details for %s', async (_name, body, fields) => {
    const req = request(h.app).post('/api/auth/login').set(CSRF);
    const res = body === undefined ? await req : await req.send(body as object);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    const got = (res.body.error.details as { field: string; message: string }[]).map((d) => d.field).sort();
    expect(got).toEqual([...fields].sort());
    for (const d of res.body.error.details) expect(typeof d.message).toBe('string');
    expect(h.sessions.rows.size).toBe(0);
  });

  it('accepts boundary lengths (254-char email, 200-char password) without a 400', async () => {
    const res = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: `${'a'.repeat(248)}@x.io`, password: 'p'.repeat(200) });
    expect(res.status).toBe(401);
  });

  it('a non-object JSON body is a 400 VALIDATION_FAILED', async () => {
    const res = await request(h.app).post('/api/auth/login').set(CSRF).send(['a', 'b']);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('two logins give different tokens and two distinct sessions (no fixation)', async () => {
    const first = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const second = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const t1 = tokenFrom(first);
    const t2 = tokenFrom(second);
    expect(t1).not.toBe(t2);
    expect(h.sessions.rows.has(sha256(t1))).toBe(true);
    expect(h.sessions.rows.has(sha256(t2))).toBe(true);
  });

  it('ignores a pre-set (attacker-chosen) cookie and issues a fresh token', async () => {
    const planted = crypto.randomBytes(32).toString('base64url');
    const res = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .set('Cookie', cookieHeader(planted))
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    const token = tokenFrom(res);
    expect(token).not.toBe(planted);
    expect(h.sessions.rows.has(sha256(planted))).toBe(false);
    await request(h.app).get('/api/auth/me').set('Cookie', cookieHeader(planted)).expect(401);
    await request(h.app).get('/api/auth/me').set('Cookie', cookieHeader(token)).expect(200);
  });

  it('never logs the password or the hash', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    await request(h.app).post('/api/auth/login').set(CSRF).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await request(h.app).post('/api/auth/login').set(CSRF).send({ email: ADMIN_EMAIL, password: 'nope-nope' });
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(ADMIN_PASSWORD);
    expect(logged).not.toContain('scrypt$');
  });
});

describe('GET /api/auth/me', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it('returns 200 { user } with a valid session', async () => {
    const login = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const res = await request(h.app).get('/api/auth/me').set('Cookie', cookieHeader(tokenFrom(login)));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: h.adminId, email: ADMIN_EMAIL } });
  });

  it('returns 401 UNAUTHENTICATED without a session', async () => {
    const res = await request(h.app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /api/auth/logout', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it('deletes the session server-side, clears the cookie and returns 204', async () => {
    const login = await request(h.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const token = tokenFrom(login);
    expect(h.sessions.rows.size).toBe(1);

    const res = await request(h.app).post('/api/auth/logout').set(CSRF).set('Cookie', cookieHeader(token));
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(h.sessions.rows.size).toBe(0);

    const cleared = sessionSetCookie(res);
    expect(cleared).toBeDefined();
    const a = attrs(cleared!);
    expect(a[0]).toBe('saltline_session=');
    expect(a).toContain('Path=/');
    expect(a).toContain('HttpOnly');
    expect(a).toContain('SameSite=Strict');
    expect(a.some((x) => /^Expires=Thu, 01 Jan 1970/.test(x))).toBe(true);

    // Replaying the old cookie no longer works.
    await request(h.app).get('/api/auth/me').set('Cookie', cookieHeader(token)).expect(401);
    await request(h.app).get('/api/admin/ping').set('Cookie', cookieHeader(token)).expect(401);
  });

  it('only removes the caller’s session', async () => {
    const a = tokenFrom(
      await request(h.app).post('/api/auth/login').set(CSRF).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    );
    const b = tokenFrom(
      await request(h.app).post('/api/auth/login').set(CSRF).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    );
    await request(h.app).post('/api/auth/logout').set(CSRF).set('Cookie', cookieHeader(a)).expect(204);
    await request(h.app).get('/api/auth/me').set('Cookie', cookieHeader(a)).expect(401);
    await request(h.app).get('/api/auth/me').set('Cookie', cookieHeader(b)).expect(200);
  });

  it('is idempotent: no cookie, unknown cookie and repeated logout all give 204 and clear the cookie', async () => {
    const none = await request(h.app).post('/api/auth/logout').set(CSRF);
    expect(none.status).toBe(204);
    expect(sessionSetCookie(none)).toBeDefined();

    const unknown = await request(h.app).post('/api/auth/logout').set(CSRF).set('Cookie', cookieHeader('nope'));
    expect(unknown.status).toBe(204);
    expect(sessionSetCookie(unknown)).toBeDefined();

    const token = tokenFrom(
      await request(h.app).post('/api/auth/login').set(CSRF).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    );
    await request(h.app).post('/api/auth/logout').set(CSRF).set('Cookie', cookieHeader(token)).expect(204);
    const again = await request(h.app).post('/api/auth/logout').set(CSRF).set('Cookie', cookieHeader(token));
    expect(again.status).toBe(204);
    expect(sessionSetCookie(again)).toBeDefined();
  });

  it('clears with Secure when cookieSecure is true', async () => {
    const hs = await makeHarness({ cookieSecure: true });
    const res = await request(hs.app).post('/api/auth/logout').set(CSRF);
    expect(attrs(sessionSetCookie(res)!)).toContain('Secure');
  });
});

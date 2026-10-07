// SEC-004: response headers and session cookie attributes on the assembled app,
// for the HTML shell (/), the API (/api/*) and stored images (/uploads/*).
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../contracts/types';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  CSRF,
  PNG_BYTES,
  cookieAttributes,
  hasBuiltUi,
  makeSecApp,
  productInput,
  type SecApp,
} from './fullstack';

const BASE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const UPLOADS_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** Headers every response must carry (CSP is checked separately per route). */
const BASELINE: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function expectBaseline(res: request.Response, label: string) {
  for (const [name, value] of Object.entries(BASELINE)) {
    expect(res.headers[name], `${label}: ${name}`).toBe(value);
  }
  expect(res.headers['x-powered-by'], `${label}: x-powered-by`).toBeUndefined();
  expect(res.headers['access-control-allow-origin'], `${label}: CORS`).toBeUndefined();
}

describe('SEC-004 headers in development config', () => {
  let t: SecApp;
  let imageUrl: string;

  beforeAll(async () => {
    t = await makeSecApp();
    const admin = await t.login();
    const id = (await admin.post('/api/admin/products').set(CSRF).send(productInput())).body.id;
    imageUrl = (await admin.post(`/api/admin/products/${id}/images`).set(CSRF).attach('image', PNG_BYTES, 'a.png')).body
      .url;
  });
  afterAll(() => t.cleanup());

  it('/api/* success, 4xx and 5xx-shaped responses all carry the baseline and the app CSP', async () => {
    const cases: Array<[string, () => request.Test]> = [
      ['GET /api/health', () => request(t.app).get('/api/health')],
      ['GET /api/products', () => request(t.app).get('/api/products')],
      ['GET /api/products/missing', () => request(t.app).get('/api/products/missing')],
      ['GET /api/nope', () => request(t.app).get('/api/nope')],
      ['GET /api/admin/products (401)', () => request(t.app).get('/api/admin/products')],
      ['POST /api/admin/products (403)', () => request(t.app).post('/api/admin/products')],
      ['POST /api/auth/login bad JSON (400)', () =>
        request(t.app).post('/api/auth/login').set(CSRF).set('Content-Type', 'application/json').send('{"email":')],
      ['POST /api/auth/login huge body (413)', () =>
        request(t.app).post('/api/auth/login').set(CSRF).send({ email: 'a', password: 'x'.repeat(200 * 1024) })],
    ];
    for (const [label, make] of cases) {
      const res = await make();
      expectBaseline(res, label);
      expect(res.headers['content-security-policy'], label).toBe(BASE_CSP);
      expect(res.headers['content-type'], label).toMatch(/^application\/json/);
      expect(res.headers['strict-transport-security'], label).toBeUndefined();
      // No stack traces, file paths or SQL in error bodies.
      expect(res.text, label).not.toMatch(/at \w+ \(|node_modules|\/Users\/|SQLITE|SELECT /);
    }
  });

  it('admin and auth responses are not cacheable', async () => {
    const admin = await t.login();
    for (const url of ['/api/admin/products', '/api/auth/me']) {
      const res = await admin.get(url);
      expect(res.status, url).toBe(200);
      expect(res.headers['cache-control'], url).toBe('no-store');
    }
  });

  it('/uploads/* gets the sandbox CSP on hits and on misses', async () => {
    for (const url of [imageUrl, '/uploads/nothing-here.png']) {
      const res = await request(t.app).get(url);
      expectBaseline(res, url);
      expect(res.headers['content-security-policy'], url).toBe(UPLOADS_CSP);
    }
  });

  it('/ in development (no built UI mounted) still carries the baseline headers', async () => {
    const res = await request(t.app).get('/');
    expectBaseline(res, '/');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('the session cookie is HttpOnly, SameSite=Strict, Path=/, 12h, and not Secure when COOKIE_SECURE is off', async () => {
    const res = await request(t.app).post('/api/auth/login').set(CSRF).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const line = [res.headers['set-cookie']].flat().find((c: string) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(line).toBeDefined();
    const a = cookieAttributes(line);
    expect(a.has('httponly')).toBe(true);
    expect(a.get('samesite')).toBe('Strict');
    expect(a.get('path')).toBe('/');
    expect(a.get('max-age')).toBe(String(12 * 60 * 60));
    expect(a.has('domain')).toBe(false);
    expect(a.has('secure')).toBe(false);
    const token = line.split(';')[0].split('=')[1];
    expect(Buffer.from(decodeURIComponent(token), 'base64url').length).toBe(32);
  });
});

describe('SEC-004 headers with COOKIE_SECURE=true', () => {
  let t: SecApp;
  beforeAll(async () => {
    t = await makeSecApp({ cookieSecure: true });
  });
  afterAll(() => t.cleanup());

  it('sends HSTS on every route and marks the cookie Secure (login and logout)', async () => {
    for (const url of ['/api/health', '/uploads/x.png', '/api/nope']) {
      const res = await request(t.app).get(url);
      expect(res.headers['strict-transport-security'], url).toBe('max-age=15552000; includeSubDomains');
    }
    const login = await request(t.app).post('/api/auth/login').set(CSRF).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const a = cookieAttributes([login.headers['set-cookie']].flat()[0]);
    expect(a.has('secure')).toBe(true);
    expect(a.has('httponly')).toBe(true);
    expect(a.get('samesite')).toBe('Strict');
    const logout = await request(t.app).post('/api/auth/logout').set(CSRF);
    expect(cookieAttributes([logout.headers['set-cookie']].flat()[0]).has('secure')).toBe(true);
  });
});

describe.skipIf(!hasBuiltUi)('SEC-004 production config serving dist/ui', () => {
  let t: SecApp;
  beforeAll(async () => {
    t = await makeSecApp({ isProduction: true });
  });
  afterAll(() => t.cleanup());

  it('/ and SPA routes get the HTML shell with the baseline and the plain CSP when COOKIE_SECURE is off', async () => {
    for (const url of ['/', '/shop', '/shirts/anything', '/admin', '/admin/login']) {
      const res = await request(t.app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.headers['content-type'], url).toMatch(/^text\/html/);
      expectBaseline(res, url);
      // DEF-001: plain HTTP in production must not ask the browser to upgrade assets to https.
      expect(res.headers['content-security-policy'], url).toBe(BASE_CSP);
      expect(res.headers['strict-transport-security'], url).toBeUndefined();
    }
  });

  it('built JS and CSS assets carry the baseline and are served with correct types', async () => {
    const html = (await request(t.app).get('/')).text;
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(0);
    for (const url of assets) {
      const res = await request(t.app).get(url);
      expect(res.status, url).toBe(200);
      expectBaseline(res, url);
      expect(res.headers['content-type'], url).toMatch(/^(text\/javascript|application\/javascript|text\/css)/);
    }
  });

  it('/api and /uploads keep their own handling in production (no SPA fallback leaks)', async () => {
    const api = await request(t.app).get('/api/nope');
    expect(api.status).toBe(404);
    expect(api.headers['content-type']).toMatch(/^application\/json/);
    const up = await request(t.app).get('/uploads/nothing.png');
    expect(up.status).toBe(404);
    expect(up.headers['content-security-policy']).toBe(UPLOADS_CSP);
    const post = await request(t.app).post('/shop').send('x');
    expect(post.status).toBe(404);
  });

  it('the server does not serve dotfiles or files outside dist/ui', async () => {
    for (const url of ['/.env', '/../.env', '/%2e%2e/.env', '/package.json', '/src/app.ts']) {
      const res = await request(t.app).get(url);
      // Unknown paths fall through to the SPA shell; it must be the shell, never the file.
      expect(res.text, url).not.toMatch(/ADMIN_PASSWORD|"dependencies"|createApp/);
    }
    expect(fs.existsSync(path.resolve('dist/ui/.env'))).toBe(false);
  });

  it('DEF-001: the HTML shell and its assets carry no upgrade-insecure-requests over plain HTTP', async () => {
    const html = await request(t.app).get('/');
    const urls = ['/', '/api/health', '/uploads/none.png', ...[...html.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])];
    for (const url of urls) {
      const res = await request(t.app).get(url);
      expect(res.headers['content-security-policy'] ?? '', url).not.toContain('upgrade-insecure-requests');
    }
  });
});

describe.skipIf(!hasBuiltUi)('SEC-004 production config over HTTPS (COOKIE_SECURE=true)', () => {
  let t: SecApp;
  beforeAll(async () => {
    t = await makeSecApp({ isProduction: true, cookieSecure: true });
  });
  afterAll(() => t.cleanup());

  it('DEF-001: the shell, API and assets get upgrade-insecure-requests and HSTS', async () => {
    const html = await request(t.app).get('/');
    const assets = [...html.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(0);
    for (const url of ['/', '/shop', '/api/health', '/api/nope', ...assets]) {
      const res = await request(t.app).get(url);
      expect(res.headers['content-security-policy'], url).toBe(`${BASE_CSP}; upgrade-insecure-requests`);
      expect(res.headers['strict-transport-security'], url).toBe('max-age=15552000; includeSubDomains');
    }
    // /uploads keeps its own sandbox policy, which replaces the app CSP entirely.
    const up = await request(t.app).get('/uploads/none.png');
    expect(up.headers['content-security-policy']).toBe(UPLOADS_CSP);
  });
});

describe('SEC-004 development config over HTTPS (COOKIE_SECURE=true, NODE_ENV not production)', () => {
  let t: SecApp;
  beforeAll(async () => {
    t = await makeSecApp({ isProduction: false, cookieSecure: true });
  });
  afterAll(() => t.cleanup());

  it('DEF-001: the directive follows HTTPS, not NODE_ENV', async () => {
    const res = await request(t.app).get('/api/health');
    expect(res.headers['content-security-policy']).toBe(`${BASE_CSP}; upgrade-insecure-requests`);
  });
});

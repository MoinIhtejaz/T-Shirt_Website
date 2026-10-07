// SEC-004: the role matrix in contracts/auth.md, checked on the assembled app.
// Every /api/admin/** route and /api/auth/me must refuse a request without a valid session.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../contracts/types';
import { CSRF, PNG_BYTES, makeSecApp, productInput, type SecApp } from './fullstack';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

describe('SEC-004 authorisation on the real app', () => {
  let t: SecApp;
  let productId: number;
  let imageId: number;
  let categoryId: number;

  beforeAll(async () => {
    t = await makeSecApp();
    const admin = await t.login();
    categoryId = (await admin.post('/api/admin/categories').set(CSRF).send({ name: 'Locked' })).body.id;
    productId = (await admin.post('/api/admin/products').set(CSRF).send(productInput({ status: 'draft' }))).body.id;
    imageId = (await admin.post(`/api/admin/products/${productId}/images`).set(CSRF).attach('image', PNG_BYTES, 'a.png'))
      .body.id;
    expect([categoryId, productId, imageId].every((n) => Number.isInteger(n))).toBe(true);
  });
  afterAll(() => t.cleanup());

  /** Every operation in contracts/openapi.yaml under /admin. */
  const adminRoutes = (): Array<[Method, string, object | undefined]> => [
    ['get', '/api/admin/products', undefined],
    ['post', '/api/admin/products', productInput({ name: 'Intruder' })],
    ['get', `/api/admin/products/${productId}`, undefined],
    ['put', `/api/admin/products/${productId}`, productInput({ name: 'Intruder' })],
    ['delete', `/api/admin/products/${productId}`, undefined],
    ['post', `/api/admin/products/${productId}/images`, undefined],
    ['patch', `/api/admin/products/${productId}/images/${imageId}`, { alt: 'pwned' }],
    ['delete', `/api/admin/products/${productId}/images/${imageId}`, undefined],
    ['post', '/api/admin/categories', { name: 'Intruder' }],
    ['put', `/api/admin/categories/${categoryId}`, { name: 'Intruder' }],
    ['delete', `/api/admin/categories/${categoryId}`, undefined],
  ];

  function send(method: Method, url: string, body: object | undefined, cookie?: string) {
    let req = request(t.app)[method](url).set(CSRF);
    if (cookie) req = req.set('Cookie', cookie);
    if (body) req = req.send(body);
    return req;
  }

  async function expectNothingChanged() {
    const product = t.repos.products.getById(productId);
    expect(product?.name).toBe('Review Tee');
    expect(t.repos.images.get(productId, imageId)?.alt).not.toBe('pwned');
    expect(t.repos.categories.getById(categoryId)?.name).toBe('Locked');
    expect(t.repos.products.list({}).some((p) => p.name === 'Intruder')).toBe(false);
  }

  it('every /api/admin route is 401 UNAUTHENTICATED with no session, and nothing changes', async () => {
    for (const [method, url, body] of adminRoutes()) {
      const res = await send(method, url, body);
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.headers['cache-control']).toBe('no-store');
    }
    await expectNothingChanged();
  });

  const badCookies: Array<[string, () => string]> = [
    ['an empty cookie', () => `${SESSION_COOKIE}=`],
    ['a random token', () => `${SESSION_COOKIE}=${crypto.randomBytes(32).toString('base64url')}`],
    ['a SQL-ish token', () => `${SESSION_COOKIE}=${encodeURIComponent("' OR '1'='1")}`],
    ['the sha256 of a real token (stored value, not the raw token)', () => `${SESSION_COOKIE}=${storedHashOfLiveToken}`],
    ['a cookie with the wrong name', () => `session=${liveToken}`],
  ];
  let liveToken = '';
  let storedHashOfLiveToken = '';

  it('forged, empty, hashed or misnamed session cookies are all 401', async () => {
    const login = await request(t.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'sec-review@saltline.test', password: 'rip-current-at-tamarama-9' });
    liveToken = /saltline_session=([^;]+)/.exec(String(login.headers['set-cookie']))?.[1] ?? '';
    expect(liveToken).not.toBe('');
    storedHashOfLiveToken = crypto.createHash('sha256').update(liveToken).digest('hex');

    for (const [label, cookie] of badCookies) {
      for (const [method, url, body] of adminRoutes()) {
        const res = await send(method, url, body, cookie());
        expect(res.status, `${label}: ${method.toUpperCase()} ${url}`).toBe(401);
      }
      const me = await request(t.app).get('/api/auth/me').set('Cookie', cookie());
      expect(me.status, `${label}: /api/auth/me`).toBe(401);
    }
    await expectNothingChanged();
  });

  it('an expired session is 401 and its row is removed', async () => {
    const token = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const admin = t.repos.admins.getByEmail('sec-review@saltline.test')!;
    t.repos.sessions.create({ tokenHash: hash, adminId: admin.id, expiresAt: new Date(Date.now() - 1000) });
    const res = await request(t.app).get('/api/admin/products').set('Cookie', `${SESSION_COOKIE}=${token}`);
    expect(res.status).toBe(401);
    expect(t.repos.sessions.get(hash)).toBeNull();
  });

  it('path tricks (case, trailing slash, double slash, encoded segments, OPTIONS, HEAD) never reach admin data', async () => {
    const variants: Array<[Method, string]> = [
      ['get', '/API/ADMIN/PRODUCTS'],
      ['get', '/api/Admin/products'],
      ['get', '/api/admin/products/'],
      ['get', '/api//admin/products'],
      ['get', '/api/admin//products'],
      ['get', '/api/%61dmin/products'],
      ['get', '/api/admin/%70roducts'],
      ['get', '/api/./admin/products'],
      ['get', `/api/admin/products/${productId}?status=published`],
      ['head', '/api/admin/products'],
      ['options', '/api/admin/products'],
    ];
    for (const [method, url] of variants) {
      const res = await request(t.app)[method](url).set(CSRF);
      expect([401, 404], `${method.toUpperCase()} ${url} -> ${res.status}`).toContain(res.status);
      expect(JSON.stringify(res.body ?? {})).not.toContain('Review Tee');
    }
  });

  it('/api/auth/me needs a session', async () => {
    const res = await request(t.app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logout really revokes the session server-side (the old cookie stops working)', async () => {
    const login = await request(t.app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ email: 'sec-review@saltline.test', password: 'rip-current-at-tamarama-9' });
    const token = /saltline_session=([^;]+)/.exec(String(login.headers['set-cookie']))?.[1] ?? '';
    const cookie = `${SESSION_COOKIE}=${token}`;
    expect((await request(t.app).get('/api/admin/products').set('Cookie', cookie)).status).toBe(200);
    await request(t.app).post('/api/auth/logout').set(CSRF).set('Cookie', cookie).expect(204);
    // Replaying the old cookie after logout must fail: the row is gone, not just the browser cookie.
    expect((await request(t.app).get('/api/admin/products').set('Cookie', cookie)).status).toBe(401);
  });

  it('public endpoints never expose drafts or admin-only fields', async () => {
    const list = await request(t.app).get('/api/products');
    expect(list.status).toBe(200);
    expect(list.body.items.find((p: { id: number }) => p.id === productId)).toBeUndefined();
    const slug = t.repos.products.getById(productId)!.slug;
    expect((await request(t.app).get(`/api/products/${slug}`)).status).toBe(404);
    for (const field of ['status', 'categoryId', 'createdAt', 'updatedAt', 'filename', 'passwordHash']) {
      expect(JSON.stringify(list.body)).not.toContain(`"${field}"`);
    }
  });

  it('positive control: the same routes work for a logged-in admin with the CSRF header', async () => {
    const admin = await t.login();
    expect((await admin.get('/api/admin/products')).status).toBe(200);
    expect((await admin.get(`/api/admin/products/${productId}`)).status).toBe(200);
    expect((await admin.get('/api/auth/me')).status).toBe(200);
  });
});

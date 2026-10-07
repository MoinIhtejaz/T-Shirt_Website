// SEC-004: CSRF guard on the assembled app (contracts/auth.md#CSRF).
// A state-changing /api request without X-Saltline-CSRF: 1 is 403, even with a valid session.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF, PNG_BYTES, makeSecApp, productInput, type SecApp, ADMIN_EMAIL, ADMIN_PASSWORD } from './fullstack';

type Write = 'post' | 'put' | 'patch' | 'delete';

describe('SEC-004 CSRF on the real app', () => {
  let t: SecApp;
  let admin: Awaited<ReturnType<SecApp['login']>>;
  let productId: number;
  let imageId: number;
  let categoryId: number;

  beforeAll(async () => {
    t = await makeSecApp();
    admin = await t.login();
    categoryId = (await admin.post('/api/admin/categories').set(CSRF).send({ name: 'Original' })).body.id;
    productId = (await admin.post('/api/admin/products').set(CSRF).send(productInput())).body.id;
    imageId = (await admin.post(`/api/admin/products/${productId}/images`).set(CSRF).attach('image', PNG_BYTES, 'a.png'))
      .body.id;
  });
  afterAll(() => t.cleanup());

  const writes = (): Array<[Write, string, object | undefined]> => [
    ['post', '/api/admin/products', productInput({ name: 'Forged' })],
    ['put', `/api/admin/products/${productId}`, productInput({ name: 'Forged', amazonUrl: 'https://amzn.to/evil' })],
    ['delete', `/api/admin/products/${productId}`, undefined],
    ['patch', `/api/admin/products/${productId}/images/${imageId}`, { alt: 'Forged' }],
    ['delete', `/api/admin/products/${productId}/images/${imageId}`, undefined],
    ['post', '/api/admin/categories', { name: 'Forged' }],
    ['put', `/api/admin/categories/${categoryId}`, { name: 'Forged' }],
    ['delete', `/api/admin/categories/${categoryId}`, undefined],
    ['post', '/api/auth/logout', undefined],
    ['post', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }],
    ['post', '/api/does-not-exist', { a: 1 }],
  ];

  function assertUntouched() {
    expect(t.repos.products.getById(productId)?.name).toBe('Review Tee');
    expect(t.repos.products.getById(productId)?.amazonUrl).toBe('https://www.amazon.com.au/dp/B000SECREV');
    expect(t.repos.images.get(productId, imageId)).not.toBeNull();
    expect(t.repos.categories.getById(categoryId)?.name).toBe('Original');
    expect(t.repos.products.list({}).some((p) => p.name === 'Forged')).toBe(false);
  }

  it('every POST/PUT/PATCH/DELETE without the header is 403 CSRF_REJECTED, even with a valid session', async () => {
    for (const [method, url, body] of writes()) {
      let req = admin[method](url);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403);
      expect(res.body.error.code).toBe('CSRF_REJECTED');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    assertUntouched();
    // The session survived the forged logout.
    expect((await admin.get('/api/auth/me')).status).toBe(200);
  });

  it('a multipart upload without the header is 403 and writes no file', async () => {
    const res = await admin.post(`/api/admin/products/${productId}/images`).attach('image', PNG_BYTES, 'b.png');
    expect(res.status).toBe(403);
    expect(t.repos.images.countForProduct(productId)).toBe(1);
  });

  it('a "simple" cross-site form post (text/plain or urlencoded) is 403', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await admin.post('/api/admin/categories').set('Content-Type', type).send('name=Forged');
      expect(res.status, type).toBe(403);
    }
    assertUntouched();
  });

  it('wrong header values are rejected; only exactly "1" passes', async () => {
    for (const value of ['0', 'true', 'yes', ' 1x', '11', '']) {
      const res = await admin.post('/api/admin/categories').set('X-Saltline-CSRF', value).send({ name: 'Forged' });
      expect(res.status, JSON.stringify(value)).toBe(403);
    }
    // A similarly named header does not count.
    const other = await admin.post('/api/admin/categories').set('X-CSRF', '1').send({ name: 'Forged' });
    expect(other.status).toBe(403);
    assertUntouched();
  });

  it('method override tricks do not turn a GET into a write', async () => {
    const res = await admin
      .get(`/api/admin/products/${productId}?_method=DELETE`)
      .set('X-HTTP-Method-Override', 'DELETE');
    expect(res.status).toBe(200);
    expect(t.repos.products.getById(productId)).not.toBeNull();
  });

  it('the server enables no CORS, so a foreign origin cannot preflight the custom header', async () => {
    const pre = await request(t.app)
      .options('/api/admin/categories')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-saltline-csrf, content-type');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    expect(pre.headers['access-control-allow-headers']).toBeUndefined();
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();

    const get = await admin.get('/api/admin/products').set('Origin', 'https://evil.example');
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('positive control: the same write succeeds with the header', async () => {
    const res = await admin.put(`/api/admin/categories/${categoryId}`).set(CSRF).send({ name: 'Original' });
    expect(res.status).toBe(200);
  });
});

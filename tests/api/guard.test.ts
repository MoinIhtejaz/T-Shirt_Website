// Admin routes need a session (401) and, for writes, the CSRF header (403).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF, PNG_BYTES, makeTestApp, productInput, type TestApp } from './helpers';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

describe('admin route guard', () => {
  let t: TestApp;
  let productId: number;
  let imageId: number;
  let categoryId: number;

  beforeAll(async () => {
    t = await makeTestApp();
    categoryId = (await t.admin.post('/api/admin/categories').set(CSRF).send({ name: 'Guarded' })).body.id;
    productId = (await t.admin.post('/api/admin/products').set(CSRF).send(productInput())).body.id;
    imageId = (await t.admin.post(`/api/admin/products/${productId}/images`).set(CSRF).attach('image', PNG_BYTES, 'a.png'))
      .body.id;
  });
  afterAll(() => t.cleanup());

  const routes = (): Array<[Method, string, object | undefined]> => [
    ['get', '/api/admin/products', undefined],
    ['post', '/api/admin/products', productInput({ name: 'Sneaky' })],
    ['get', `/api/admin/products/${productId}`, undefined],
    ['put', `/api/admin/products/${productId}`, productInput({ name: 'Sneaky' })],
    ['delete', `/api/admin/products/${productId}`, undefined],
    ['post', `/api/admin/products/${productId}/images`, undefined],
    ['patch', `/api/admin/products/${productId}/images/${imageId}`, { alt: 'x' }],
    ['delete', `/api/admin/products/${productId}/images/${imageId}`, undefined],
    ['post', '/api/admin/categories', { name: 'Sneaky' }],
    ['put', `/api/admin/categories/${categoryId}`, { name: 'Sneaky' }],
    ['delete', `/api/admin/categories/${categoryId}`, undefined],
  ];

  it('every admin route is 401 UNAUTHENTICATED without a session', async () => {
    for (const [method, url, body] of routes()) {
      let req = request(t.app)[method](url).set(CSRF);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('a bogus session cookie is 401 too', async () => {
    const res = await request(t.app).get('/api/admin/products').set('Cookie', 'saltline_session=forged');
    expect(res.status).toBe(401);
  });

  it('every admin write is 403 CSRF_REJECTED without the header, even when logged in', async () => {
    for (const [method, url, body] of routes()) {
      if (method === 'get') continue;
      let req = t.admin[method](url);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403);
      expect(res.body.error.code).toBe('CSRF_REJECTED');
    }
    // Nothing changed.
    expect(t.repos.products.getById(productId)?.name).toBe('Bondi Swell Tee');
    expect(t.repos.images.get(productId, imageId)).not.toBeNull();
    expect(t.repos.categories.getById(categoryId)).not.toBeNull();
  });

  it('an unknown /api route is still the glue 404', async () => {
    const res = await request(t.app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// BE-001: public catalogue routes.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF, PNG_BYTES, makeTestApp, productInput, type TestApp } from './helpers';

const ADMIN_ONLY_KEYS = ['status', 'categoryId', 'createdAt', 'updatedAt', 'filename', 'productId'];

function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, into));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
  return into;
}

describe('public catalogue', () => {
  let t: TestApp;
  let teesId: number;
  let publishedSlug: string;

  beforeAll(async () => {
    t = await makeTestApp();
    const tees = await t.admin.post('/api/admin/categories').set(CSRF).send({ name: 'Tees', sortOrder: 2 });
    await t.admin.post('/api/admin/categories').set(CSRF).send({ name: 'Art', sortOrder: 1 });
    teesId = tees.body.id;

    const pub = await t.admin
      .post('/api/admin/products')
      .set(CSRF)
      .send(productInput({ name: 'Published Tee', categoryId: teesId, featured: false }));
    publishedSlug = pub.body.slug;
    await t.admin
      .post(`/api/admin/products/${pub.body.id}/images`)
      .set(CSRF)
      .attach('image', PNG_BYTES, 'a.png');
    await t.admin
      .post('/api/admin/products')
      .set(CSRF)
      .send(productInput({ name: 'Featured Tee', featured: true }));
    await t.admin
      .post('/api/admin/products')
      .set(CSRF)
      .send(productInput({ name: 'Secret Draft', status: 'draft', categoryId: teesId, featured: true }));
  });
  afterAll(() => t.cleanup());

  it('GET /api/health is ok', async () => {
    const res = await request(t.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/categories lists categories by sortOrder', async () => {
    const res = await request(t.app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['Art', 'Tees']);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['id', 'name', 'slug', 'sortOrder']);
  });

  it('GET /api/products returns published products only, featured first', async () => {
    const res = await request(t.app).get('/api/products');
    expect(res.status).toBe(200);
    const names = res.body.items.map((p: { name: string }) => p.name);
    expect(names).toEqual(['Featured Tee', 'Published Tee']);
    expect(names).not.toContain('Secret Draft');
  });

  it('filters by category slug, and an unknown slug gives an empty list', async () => {
    const res = await request(t.app).get('/api/products?category=tees');
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['Published Tee']);
    const none = await request(t.app).get('/api/products?category=nope');
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ items: [] });
  });

  it('featured=true filters to featured products, other values are ignored', async () => {
    const res = await request(t.app).get('/api/products?featured=true');
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['Featured Tee']);
    const ignored = await request(t.app).get('/api/products?featured=yes');
    expect(ignored.body.items).toHaveLength(2);
  });

  it('list items are exactly ProductSummary and leak no admin fields', async () => {
    const res = await request(t.app).get('/api/products');
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['category', 'colours', 'currency', 'featured', 'id', 'name', 'primaryImage', 'priceCents', 'slug'].sort(),
      );
    }
    const keys = collectKeys(res.body);
    for (const k of ADMIN_ONLY_KEYS) expect(keys.has(k)).toBe(false);
    const pub = res.body.items.find((p: { name: string }) => p.name === 'Published Tee');
    expect(pub.category).toEqual({ slug: 'tees', name: 'Tees' });
    expect(pub.currency).toBe('AUD');
    expect(Object.keys(pub.primaryImage).sort()).toEqual(['alt', 'id', 'sortOrder', 'url']);
    expect(pub.primaryImage.url).toMatch(/^\/uploads\/[0-9a-f]{32}\.png$/);
  });

  it('GET /api/products/:slug returns a full Product without admin fields', async () => {
    const res = await request(t.app).get(`/api/products/${publishedSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('published-tee');
    expect(res.body.sizes).toEqual(['S', 'M']);
    expect(res.body.colours).toEqual([{ name: 'Harbour Blue', hex: '#1A4E8A' }]);
    expect(res.body.images).toHaveLength(1);
    expect(res.body.amazonUrl).toBe('https://www.amazon.com.au/dp/B000TEST01');
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'amazonUrl', 'category', 'colours', 'currency', 'description', 'featured', 'id', 'images', 'name',
        'primaryImage', 'priceCents', 'sizes', 'slug',
      ].sort(),
    );
    const keys = collectKeys(res.body);
    for (const k of ADMIN_ONLY_KEYS) expect(keys.has(k)).toBe(false);
  });

  it('a draft gives the same 404 as a missing product', async () => {
    const draft = await request(t.app).get('/api/products/secret-draft');
    const missing = await request(t.app).get('/api/products/does-not-exist');
    expect(draft.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(draft.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
    expect(draft.body).toEqual(missing.body);
  });

  it('public responses are not marked no-store, admin ones are', async () => {
    const pub = await request(t.app).get('/api/products');
    expect(pub.headers['cache-control'] ?? '').not.toContain('no-store');
    const adm = await t.admin.get('/api/admin/products');
    expect(adm.headers['cache-control']).toBe('no-store');
    const anon = await request(t.app).get('/api/admin/products');
    expect(anon.headers['cache-control']).toBe('no-store');
  });
});

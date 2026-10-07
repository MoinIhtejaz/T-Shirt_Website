// BE-004: admin category routes.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CSRF, makeTestApp, productInput, type TestApp } from './helpers';

describe('admin categories', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(() => t.cleanup());

  const create = (body: object) => t.admin.post('/api/admin/categories').set(CSRF).send(body);

  it('POST creates a category (201) with a generated slug and default sortOrder 0', async () => {
    const res = await create({ name: '  Ocean Prints ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), slug: 'ocean-prints', name: 'Ocean Prints', sortOrder: 0 });
  });

  it('generated slugs collide into -2; "category" is the fallback', async () => {
    const a = await create({ name: 'Dupes' });
    const b = await create({ name: 'Dupes', slug: '' });
    expect([a.body.slug, b.body.slug]).toEqual(['dupes', 'dupes-2']);
    const fallback = await create({ name: '!!!' });
    expect(fallback.body.slug).toBe('category');
  });

  it('a duplicate explicit slug gives 409 SLUG_TAKEN', async () => {
    const first = await create({ name: 'Mine', slug: 'taken-slug', sortOrder: -5 });
    expect(first.status).toBe(201);
    expect(first.body.sortOrder).toBe(-5);
    const dupe = await create({ name: 'Yours', slug: 'taken-slug' });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('SLUG_TAKEN');
    expect(dupe.body.error.details.map((d: { field: string }) => d.field)).toEqual(['slug']);
  });

  it('validates the body', async () => {
    const res = await create({ name: '', slug: 'Not Valid', sortOrder: 1001, extra: true });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(
      ['extra', 'name', 'slug', 'sortOrder'].sort(),
    );
    const long = await create({ name: 'x'.repeat(61) });
    expect(long.body.error.details).toEqual([{ field: 'name', message: 'Must be 60 characters or fewer.' }]);
  });

  it('PUT updates name and sortOrder, keeps the slug when omitted, 409 on a taken slug', async () => {
    const made = await create({ name: 'Renamable' });
    const other = await create({ name: 'Other Cat' });
    const id = made.body.id;
    const put = await t.admin.put(`/api/admin/categories/${id}`).set(CSRF).send({ name: 'Renamed', sortOrder: 7 });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ id, slug: 'renamable', name: 'Renamed', sortOrder: 7 });
    const newSlug = await t.admin.put(`/api/admin/categories/${id}`).set(CSRF).send({ name: 'Renamed', slug: 'fresh' });
    expect(newSlug.body.slug).toBe('fresh');
    const clash = await t.admin
      .put(`/api/admin/categories/${id}`)
      .set(CSRF)
      .send({ name: 'Renamed', slug: other.body.slug });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SLUG_TAKEN');
    expect((await t.admin.put('/api/admin/categories/99999').set(CSRF).send({ name: 'X' })).status).toBe(404);
    expect((await t.admin.put('/api/admin/categories/abc').set(CSRF).send({ name: 'X' })).status).toBe(400);
  });

  it('DELETE (204) leaves its products uncategorised', async () => {
    const cat = await create({ name: 'Going Away' });
    const prod = await t.admin
      .post('/api/admin/products')
      .set(CSRF)
      .send(productInput({ name: 'Orphan Tee', categoryId: cat.body.id }));
    expect(prod.body.categoryId).toBe(cat.body.id);

    const del = await t.admin.delete(`/api/admin/categories/${cat.body.id}`).set(CSRF);
    expect(del.status).toBe(204);

    const after = await t.admin.get(`/api/admin/products/${prod.body.id}`);
    expect(after.body.categoryId).toBeNull();
    expect(after.body.category).toBeNull();
    const pub = await request(t.app).get(`/api/products/${prod.body.slug}`);
    expect(pub.body.category).toBeNull();
    const list = await request(t.app).get('/api/categories');
    expect(list.body.items.map((c: { slug: string }) => c.slug)).not.toContain('going-away');

    expect((await t.admin.delete(`/api/admin/categories/${cat.body.id}`).set(CSRF)).status).toBe(404);
    expect((await t.admin.delete('/api/admin/categories/0').set(CSRF)).status).toBe(400);
  });
});

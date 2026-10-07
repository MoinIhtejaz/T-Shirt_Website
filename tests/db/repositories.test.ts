import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { UniqueViolationError, type ProductWrite, type Repositories } from '../../contracts/modules';
import { createRepositories, openDatabase } from '../../src/db/index';

let db: DatabaseSync;
let repos: Repositories;

beforeEach(() => {
  db = openDatabase(':memory:');
  repos = createRepositories(db);
});

function productWrite(overrides: Partial<ProductWrite> = {}): ProductWrite {
  return {
    slug: 'bondi-sunrise-tee',
    name: 'Bondi Sunrise Tee',
    description: 'First line.\n\nSecond paragraph.',
    priceCents: 4900,
    categoryId: null,
    colours: [{ name: 'Bondi Blue', hex: '#0095b6' }],
    sizes: ['M', 'S'],
    amazonUrl: 'https://www.amazon.com.au/dp/B0TEST0001',
    featured: false,
    status: 'published',
    ...overrides,
  };
}

function expectUnique(fn: () => unknown, field: 'slug' | 'email' | 'filename'): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(UniqueViolationError);
    expect((err as UniqueViolationError).field).toBe(field);
    return;
  }
  throw new Error('expected UniqueViolationError');
}

/** Force a deterministic created_at so ordering tests don't depend on the clock. */
function setCreatedAt(id: number, iso: string): void {
  db.prepare('UPDATE products SET created_at = ? WHERE id = ?').run(iso, id);
}

describe('CategoryRepo (DB-002)', () => {
  it('creates, reads, lists by sortOrder then name, and updates', () => {
    const b = repos.categories.create({ slug: 'sydney-icons', name: 'Sydney Icons', sortOrder: 1 });
    const a = repos.categories.create({ slug: 'graphic', name: 'Graphic', sortOrder: 1 });
    const c = repos.categories.create({ slug: 'essentials', name: 'Essentials', sortOrder: 0 });
    expect(a).toEqual({ id: a.id, slug: 'graphic', name: 'Graphic', sortOrder: 1 });
    expect(repos.categories.list().map((x) => x.slug)).toEqual(['essentials', 'graphic', 'sydney-icons']);
    expect(repos.categories.getById(b.id)).toEqual(b);
    expect(repos.categories.getBySlug('essentials')).toEqual(c);
    expect(repos.categories.getById(999)).toBeNull();
    expect(repos.categories.getBySlug('nope')).toBeNull();

    const updated = repos.categories.update(a.id, { slug: 'graphics', name: 'Graphics', sortOrder: 5 });
    expect(updated).toEqual({ id: a.id, slug: 'graphics', name: 'Graphics', sortOrder: 5 });
    expect(repos.categories.update(999, { slug: 'x', name: 'X', sortOrder: 0 })).toBeNull();
  });

  it('throws UniqueViolationError("slug") on duplicate slug for create and update', () => {
    const a = repos.categories.create({ slug: 'graphic', name: 'Graphic', sortOrder: 0 });
    repos.categories.create({ slug: 'essentials', name: 'Essentials', sortOrder: 0 });
    expectUnique(() => repos.categories.create({ slug: 'graphic', name: 'Other', sortOrder: 0 }), 'slug');
    expectUnique(() => repos.categories.update(a.id, { slug: 'essentials', name: 'G', sortOrder: 0 }), 'slug');
  });

  it('deleting a category nulls categoryId on its products', () => {
    const cat = repos.categories.create({ slug: 'graphic', name: 'Graphic', sortOrder: 0 });
    const p = repos.products.create(productWrite({ categoryId: cat.id }));
    expect(p.categoryId).toBe(cat.id);
    expect(repos.categories.delete(cat.id)).toBe(true);
    expect(repos.categories.delete(cat.id)).toBe(false);
    const after = repos.products.getById(p.id)!;
    expect(after.categoryId).toBeNull();
    expect(after.category).toBeNull();
  });
});

describe('ProductRepo (DB-002)', () => {
  it('maps rows to AdminProduct with category ref, images, primaryImage and AUD', () => {
    const cat = repos.categories.create({ slug: 'graphic', name: 'Graphic', sortOrder: 0 });
    const created = repos.products.create(
      productWrite({
        categoryId: cat.id,
        featured: true,
        colours: [
          { name: 'Bondi Blue', hex: '#0095b6' },
          { name: 'Salt White', hex: '#F4F1EA' },
        ],
        sizes: ['XL', 'S', 'M', 'S'],
      }),
    );
    expect(created.images).toEqual([]);
    expect(created.primaryImage).toBeNull();

    const i1 = repos.images.create({ productId: created.id, filename: 'aaa.svg', alt: 'one' }); // sort 0
    const i2 = repos.images.create({ productId: created.id, filename: 'bbb.svg', alt: 'two' }); // sort 1
    const i3 = repos.images.create({ productId: created.id, filename: 'ccc.svg', alt: 'three' }); // sort 2
    repos.images.update(created.id, i3.id, { sortOrder: 0 }); // ties with i1, i1 has the lower id

    const p = repos.products.getById(created.id)!;
    expect(p).toEqual({
      id: created.id,
      slug: 'bondi-sunrise-tee',
      name: 'Bondi Sunrise Tee',
      priceCents: 4900,
      currency: 'AUD',
      category: { slug: 'graphic', name: 'Graphic' },
      primaryImage: { id: i1.id, url: '/uploads/aaa.svg', alt: 'one', sortOrder: 0 },
      colours: [
        { name: 'Bondi Blue', hex: '#0095B6' },
        { name: 'Salt White', hex: '#F4F1EA' },
      ],
      featured: true,
      description: 'First line.\n\nSecond paragraph.',
      sizes: ['S', 'M', 'XL'],
      images: [
        { id: i1.id, url: '/uploads/aaa.svg', alt: 'one', sortOrder: 0 },
        { id: i3.id, url: '/uploads/ccc.svg', alt: 'three', sortOrder: 0 },
        { id: i2.id, url: '/uploads/bbb.svg', alt: 'two', sortOrder: 1 },
      ],
      amazonUrl: 'https://www.amazon.com.au/dp/B0TEST0001',
      categoryId: cat.id,
      status: 'published',
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    expect(typeof p.featured).toBe('boolean');
    expect(repos.products.getBySlug('bondi-sunrise-tee')).toEqual(p);
    expect(repos.products.getBySlug('missing')).toBeNull();
    expect(repos.products.getById(999)).toBeNull();

    // list() returns the same mapping (images included without per-product queries).
    expect(repos.products.list({})).toEqual([p]);
  });

  it('list() filters by status, categorySlug and featured', () => {
    const graphic = repos.categories.create({ slug: 'graphic', name: 'Graphic', sortOrder: 0 });
    const ess = repos.categories.create({ slug: 'essentials', name: 'Essentials', sortOrder: 1 });
    const a = repos.products.create(productWrite({ slug: 'a', categoryId: graphic.id, featured: true }));
    const b = repos.products.create(productWrite({ slug: 'b', categoryId: graphic.id, status: 'draft' }));
    const c = repos.products.create(productWrite({ slug: 'c', categoryId: ess.id }));
    const d = repos.products.create(productWrite({ slug: 'd', categoryId: null, featured: true, status: 'draft' }));
    const slugs = (q: Parameters<Repositories['products']['list']>[0]) =>
      repos.products
        .list(q)
        .map((p) => p.slug)
        .sort();

    expect(slugs({})).toEqual(['a', 'b', 'c', 'd']);
    expect(slugs({ status: 'published' })).toEqual(['a', 'c']);
    expect(slugs({ status: 'draft' })).toEqual(['b', 'd']);
    expect(slugs({ categorySlug: 'graphic' })).toEqual(['a', 'b']);
    expect(slugs({ categorySlug: 'essentials', status: 'published' })).toEqual(['c']);
    expect(slugs({ categorySlug: 'unknown' })).toEqual([]);
    expect(slugs({ featured: true })).toEqual(['a', 'd']);
    expect(slugs({ featured: false })).toEqual(['b', 'c']);
    expect(slugs({ featured: true, status: 'published', categorySlug: 'graphic' })).toEqual(['a']);
    expect([a, b, c, d].every((p) => p.id > 0)).toBe(true);
  });

  it('list() orders by featured DESC, created_at DESC, id DESC', () => {
    const p1 = repos.products.create(productWrite({ slug: 'p1' }));
    const p2 = repos.products.create(productWrite({ slug: 'p2', featured: true }));
    const p3 = repos.products.create(productWrite({ slug: 'p3' }));
    const p4 = repos.products.create(productWrite({ slug: 'p4', featured: true }));
    const p5 = repos.products.create(productWrite({ slug: 'p5' }));
    setCreatedAt(p1.id, '2026-01-03T00:00:00.000Z'); // newest non-featured
    setCreatedAt(p2.id, '2026-01-01T00:00:00.000Z');
    setCreatedAt(p3.id, '2026-01-02T00:00:00.000Z'); // ties with p5; p5 has the higher id
    setCreatedAt(p4.id, '2026-01-02T00:00:00.000Z');
    setCreatedAt(p5.id, '2026-01-02T00:00:00.000Z');

    expect(repos.products.list({}).map((p) => p.slug)).toEqual(['p4', 'p2', 'p1', 'p5', 'p3']);
  });

  it('list() attaches each product its own images', () => {
    const x = repos.products.create(productWrite({ slug: 'x' }));
    const y = repos.products.create(productWrite({ slug: 'y' }));
    repos.products.create(productWrite({ slug: 'z' }));
    repos.images.create({ productId: x.id, filename: 'x1.svg', alt: '' });
    repos.images.create({ productId: y.id, filename: 'y1.svg', alt: '' });
    repos.images.create({ productId: x.id, filename: 'x2.svg', alt: '' });

    const bySlug = Object.fromEntries(repos.products.list({}).map((p) => [p.slug, p]));
    expect(bySlug.x.images.map((i) => i.url)).toEqual(['/uploads/x1.svg', '/uploads/x2.svg']);
    expect(bySlug.y.images.map((i) => i.url)).toEqual(['/uploads/y1.svg']);
    expect(bySlug.y.primaryImage?.url).toBe('/uploads/y1.svg');
    expect(bySlug.z.images).toEqual([]);
    expect(bySlug.z.primaryImage).toBeNull();
  });

  it('throws UniqueViolationError("slug") on duplicate slug for create and update', () => {
    repos.products.create(productWrite({ slug: 'taken' }));
    const other = repos.products.create(productWrite({ slug: 'other' }));
    expectUnique(() => repos.products.create(productWrite({ slug: 'taken' })), 'slug');
    expectUnique(() => repos.products.update(other.id, productWrite({ slug: 'taken' })), 'slug');
  });

  it('update() replaces fields and bumps updated_at; returns null for a missing id', () => {
    const p = repos.products.create(productWrite());
    db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', p.id);

    const updated = repos.products.update(
      p.id,
      productWrite({ slug: 'renamed', name: 'Renamed', priceCents: 5900, featured: true, status: 'draft' }),
    )!;
    expect(updated).toMatchObject({ slug: 'renamed', name: 'Renamed', priceCents: 5900, featured: true, status: 'draft' });
    expect(updated.createdAt).toBe(p.createdAt);
    expect(updated.updatedAt > '2000-01-01T00:00:00.000Z').toBe(true);
    expect(repos.products.update(999, productWrite({ slug: 'nope' }))).toBeNull();
  });

  it('delete() removes the product and cascades its image rows', () => {
    const p = repos.products.create(productWrite());
    repos.images.create({ productId: p.id, filename: 'a.svg', alt: '' });
    expect(repos.products.delete(p.id)).toBe(true);
    expect(repos.products.getById(p.id)).toBeNull();
    expect(repos.images.countForProduct(p.id)).toBe(0);
    expect(repos.products.delete(p.id)).toBe(false);
  });
});

describe('ImageRepo (DB-003)', () => {
  it('assigns sortOrder = max + 1 (0 when none) and url = /uploads/<filename>', () => {
    const p = repos.products.create(productWrite());
    const first = repos.images.create({ productId: p.id, filename: 'one.svg', alt: 'One' });
    expect(first).toEqual({ id: first.id, productId: p.id, filename: 'one.svg', url: '/uploads/one.svg', alt: 'One', sortOrder: 0 });

    repos.images.update(p.id, first.id, { sortOrder: 6 });
    const second = repos.images.create({ productId: p.id, filename: 'two.svg', alt: '' });
    expect(second.sortOrder).toBe(7);
    expect(second.url).toBe('/uploads/two.svg');

    const other = repos.products.create(productWrite({ slug: 'other' }));
    expect(repos.images.create({ productId: other.id, filename: 'three.svg', alt: '' }).sortOrder).toBe(0);
  });

  it('lists, gets, counts, updates and deletes scoped to the product', () => {
    const p = repos.products.create(productWrite());
    const q = repos.products.create(productWrite({ slug: 'q' }));
    const a = repos.images.create({ productId: p.id, filename: 'a.svg', alt: 'A' });
    const b = repos.images.create({ productId: p.id, filename: 'b.svg', alt: 'B' });

    expect(repos.images.listForProduct(p.id).map((i) => i.id)).toEqual([a.id, b.id]);
    expect(repos.images.countForProduct(p.id)).toBe(2);
    expect(repos.images.countForProduct(q.id)).toBe(0);
    expect(repos.images.get(p.id, a.id)).toEqual(a);
    expect(repos.images.get(q.id, a.id)).toBeNull();

    expect(repos.images.update(p.id, a.id, { alt: 'New alt' })).toEqual({ ...a, alt: 'New alt' });
    expect(repos.images.update(p.id, a.id, { sortOrder: 9 })).toEqual({ ...a, alt: 'New alt', sortOrder: 9 });
    expect(repos.images.update(p.id, a.id, {})).toEqual({ ...a, alt: 'New alt', sortOrder: 9 });
    expect(repos.images.update(q.id, a.id, { alt: 'x' })).toBeNull();
    expect(repos.images.listForProduct(p.id).map((i) => i.id)).toEqual([b.id, a.id]);

    expect(repos.images.delete(q.id, a.id)).toBe(false);
    expect(repos.images.delete(p.id, a.id)).toBe(true);
    expect(repos.images.delete(p.id, a.id)).toBe(false);
    expect(repos.images.countForProduct(p.id)).toBe(1);
  });

  it('throws UniqueViolationError("filename") on a duplicate filename', () => {
    const p = repos.products.create(productWrite());
    repos.images.create({ productId: p.id, filename: 'same.svg', alt: '' });
    expectUnique(() => repos.images.create({ productId: p.id, filename: 'same.svg', alt: '' }), 'filename');
  });
});

describe('AdminRepo (DB-003)', () => {
  it('getByEmail is case-insensitive and returns the password hash', () => {
    const admin = repos.admins.upsert('Owner@Example.com', 'hash-1');
    expect(admin).toEqual({ id: admin.id, email: 'Owner@Example.com' });
    expect(repos.admins.getByEmail('owner@example.com')).toEqual({
      id: admin.id,
      email: 'Owner@Example.com',
      passwordHash: 'hash-1',
    });
    expect(repos.admins.getByEmail('OWNER@EXAMPLE.COM')?.id).toBe(admin.id);
    expect(repos.admins.getByEmail('nobody@example.com')).toBeNull();
  });

  it('upsert replaces the hash for an existing email (any case) without a new row', () => {
    const first = repos.admins.upsert('owner@example.com', 'hash-1');
    const second = repos.admins.upsert('OWNER@example.com', 'hash-2');
    expect(second.id).toBe(first.id);
    expect(repos.admins.getByEmail('owner@example.com')?.passwordHash).toBe('hash-2');
    expect((db.prepare('SELECT COUNT(*) AS n FROM admins').get() as unknown as { n: number }).n).toBe(1);
  });

  it('getById returns the user without the hash', () => {
    const admin = repos.admins.upsert('owner@example.com', 'hash-1');
    expect(repos.admins.getById(admin.id)).toEqual({ id: admin.id, email: 'owner@example.com' });
    expect(repos.admins.getById(999)).toBeNull();
  });
});

describe('SessionRepo (DB-003)', () => {
  it('get returns expiresAt as a Date; delete removes the row', () => {
    const admin = repos.admins.upsert('owner@example.com', 'hash');
    const expiresAt = new Date('2030-05-01T10:20:30.400Z');
    repos.sessions.create({ tokenHash: 'a'.repeat(64), adminId: admin.id, expiresAt });

    const got = repos.sessions.get('a'.repeat(64))!;
    expect(got.expiresAt).toBeInstanceOf(Date);
    expect(got).toEqual({ tokenHash: 'a'.repeat(64), adminId: admin.id, expiresAt });
    expect(repos.sessions.get('b'.repeat(64))).toBeNull();

    repos.sessions.delete('a'.repeat(64));
    expect(repos.sessions.get('a'.repeat(64))).toBeNull();
    expect(() => repos.sessions.delete('a'.repeat(64))).not.toThrow();
  });

  it('deleteExpired removes only past rows and returns the count', () => {
    const admin = repos.admins.upsert('owner@example.com', 'hash');
    const now = new Date('2026-10-06T12:00:00.000Z');
    repos.sessions.create({ tokenHash: 'past1', adminId: admin.id, expiresAt: new Date('2026-10-06T11:59:59.999Z') });
    repos.sessions.create({ tokenHash: 'past2', adminId: admin.id, expiresAt: new Date('2025-01-01T00:00:00.000Z') });
    repos.sessions.create({ tokenHash: 'future', adminId: admin.id, expiresAt: new Date('2026-10-06T12:00:00.001Z') });

    expect(repos.sessions.deleteExpired(now)).toBe(2);
    expect(repos.sessions.get('past1')).toBeNull();
    expect(repos.sessions.get('past2')).toBeNull();
    expect(repos.sessions.get('future')).not.toBeNull();
    expect(repos.sessions.deleteExpired(now)).toBe(0);
  });

  it('sessions cascade when their admin is deleted (FK enforced)', () => {
    const admin = repos.admins.upsert('owner@example.com', 'hash');
    repos.sessions.create({ tokenHash: 'tok', adminId: admin.id, expiresAt: new Date('2030-01-01T00:00:00.000Z') });
    db.prepare('DELETE FROM admins WHERE id = ?').run(admin.id);
    expect(repos.sessions.get('tok')).toBeNull();
    expect(() =>
      repos.sessions.create({ tokenHash: 'orphan', adminId: 999, expiresAt: new Date('2030-01-01T00:00:00.000Z') }),
    ).toThrow();
  });
});

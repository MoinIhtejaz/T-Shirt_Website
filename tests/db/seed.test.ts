import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repositories } from '../../contracts/modules';
import { SIZES } from '../../contracts/types';
import { createRepositories, openDatabase } from '../../src/db/index';
import {
  CatalogueError,
  DEFAULT_CATALOGUE_DIR,
  loadCatalogue,
  seedDatabase,
  seedImageFilename,
} from '../../src/db/seed';
import { isAllowedAmazonUrl } from '../../src/security/index';

const fakeHash = async (plain: string) => `fake$${plain.length}$${plain.split('').reverse().join('')}`;
const admin = { email: 'Owner@Example.com', password: 'a-long-test-password' };

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REAL_CATALOGUE = path.join(PROJECT_ROOT, 'catalogue');
const realJson = JSON.parse(fs.readFileSync(path.join(REAL_CATALOGUE, 'products.json'), 'utf8')) as {
  categories: { slug: string; name: string; sortOrder: number }[];
  products: {
    slug: string;
    name: string;
    category: string;
    amazonUrl: string | null;
    featured: boolean;
    images: { file: string; alt: string }[];
  }[];
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

type FixtureProduct = Record<string, unknown>;

function fixtureProduct(overrides: FixtureProduct = {}): FixtureProduct {
  return {
    slug: 'fixture-tee',
    name: 'Fixture Tee',
    category: 'basics',
    description: 'A test shirt.\nSecond paragraph.',
    priceCents: 2995,
    colours: [{ name: 'Black', hex: '#1e212a' }],
    sizes: ['XL', 'S', 'M'],
    amazonUrl: 'https://www.amazon.com.au/dp/B0TEST0001',
    featured: false,
    images: [{ file: 'a.jpg', alt: 'Fixture tee front' }],
    ...overrides,
  };
}

let db: DatabaseSync;
let repos: Repositories;
let tmp: string;
let uploadDir: string;

/** Writes a fixture catalogue (products.json + images/) and returns its directory. */
function writeCatalogue(products: FixtureProduct[], images: Record<string, Buffer> = { 'a.jpg': JPEG }): string {
  const dir = fs.mkdtempSync(path.join(tmp, 'catalogue-'));
  fs.mkdirSync(path.join(dir, 'images'));
  for (const [name, bytes] of Object.entries(images)) fs.writeFileSync(path.join(dir, 'images', name), bytes);
  const json = { categories: [{ slug: 'basics', name: 'Basics', sortOrder: 0 }], products };
  fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify(json));
  return dir;
}

function expectNothingWritten(): void {
  expect(repos.admins.getByEmail(admin.email)).toBeNull();
  expect(repos.categories.list()).toEqual([]);
  expect(repos.products.list({})).toEqual([]);
  expect(fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []).toEqual([]);
}

beforeEach(() => {
  db = openDatabase(':memory:');
  repos = createRepositories(db);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-test-'));
  uploadDir = path.join(tmp, 'uploads');
});

afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('seedDatabase with the real catalogue (DB-005)', () => {
  it('resolves catalogue/ from the project root, not the cwd', () => {
    expect(path.resolve(DEFAULT_CATALOGUE_DIR)).toBe(REAL_CATALOGUE);
  });

  it('upserts the admin with the hashed password', async () => {
    const result = await seedDatabase(db, uploadDir, admin, fakeHash);
    const record = repos.admins.getByEmail('owner@example.com')!;
    expect(record.id).toBe(result.adminId);
    expect(record.passwordHash).toBe(await fakeHash(admin.password));
    expect(record.passwordHash).not.toContain(admin.password);
  });

  it('loads 4 categories and 7 published products exactly as given', async () => {
    const result = await seedDatabase(db, uploadDir, admin, fakeHash);
    expect(result).toMatchObject({ catalogueSeeded: true, categoriesSeeded: 4, categoriesCreated: 4, productsCreated: 7 });

    expect(repos.categories.list().map(({ slug, name, sortOrder }) => ({ slug, name, sortOrder }))).toEqual(
      realJson.categories,
    );
    expect(repos.products.list({})).toHaveLength(7);
    expect(repos.products.list({ status: 'published' })).toHaveLength(7);

    for (const expected of realJson.products) {
      const p = repos.products.getBySlug(expected.slug)!;
      expect(p, expected.slug).not.toBeNull();
      expect(p.name).toBe(expected.name);
      expect(p.category?.slug).toBe(expected.category);
      expect(p.featured).toBe(expected.featured);
      expect(p.status).toBe('published');
      expect(p.sizes).toEqual(SIZES.filter((s) => p.sizes.includes(s)));
      expect(p.amazonUrl).toBe(expected.amazonUrl);
      if (p.amazonUrl !== null) expect(isAllowedAmazonUrl(p.amazonUrl), p.amazonUrl).toBe(true);
    }
    expect(repos.products.list({ featured: true }).map((p) => p.slug).sort()).toEqual(
      realJson.products.filter((p) => p.featured).map((p) => p.slug).sort(),
    );
  });

  it('copies the 7 images under sha256-derived names, byte for byte, keeping alt text', async () => {
    const result = await seedDatabase(db, uploadDir, admin, fakeHash);
    expect(result.imagesWritten).toHaveLength(7);
    expect(fs.readdirSync(uploadDir)).toHaveLength(7);

    for (const expected of realJson.products) {
      const images = repos.images.listForProduct(repos.products.getBySlug(expected.slug)!.id);
      expect(images).toHaveLength(expected.images.length);
      images.forEach((img, i) => {
        expect(img.filename).toMatch(/^[0-9a-f]{32}\.jpg$/);
        expect(img.url).toBe(`/uploads/${img.filename}`);
        expect(img.alt).toBe(expected.images[i].alt);
        const copied = fs.readFileSync(path.join(uploadDir, img.filename));
        const original = fs.readFileSync(path.join(REAL_CATALOGUE, 'images', expected.images[i].file));
        const digest = crypto
          .createHash('sha256')
          .update(Buffer.concat([Buffer.from(`${expected.slug}\0${expected.images[i].file}\0`), original]))
          .digest('hex');
        expect(img.filename).toBe(`${digest.slice(0, 32)}.jpg`);
        expect(copied.equals(original)).toBe(true);
      });
    }
  });

  it('reuses an existing category by slug when products is empty', async () => {
    const existing = repos.categories.create({ slug: 'australia', name: 'Australia', sortOrder: 0 });
    const result = await seedDatabase(db, uploadDir, admin, fakeHash);
    expect(result.categoriesCreated).toBe(3);
    expect(repos.categories.list()).toHaveLength(4);
    expect(repos.products.list({ categorySlug: 'australia' }).every((p) => p.categoryId === existing.id)).toBe(true);
    expect(repos.products.list({ categorySlug: 'australia' })).toHaveLength(3);
  });

  it('second run is a no-op for the catalogue but still upserts the admin', async () => {
    const first = await seedDatabase(db, uploadDir, admin, fakeHash);
    const filesAfterFirst = fs.readdirSync(uploadDir).sort();

    const second = await seedDatabase(
      db,
      uploadDir,
      { email: 'owner@example.com', password: 'a-different-password' },
      fakeHash,
    );
    expect(second).toMatchObject({ catalogueSeeded: false, productsCreated: 0, imagesWritten: [] });
    expect(second.adminId).toBe(first.adminId);
    expect(repos.admins.getByEmail('owner@example.com')!.passwordHash).toBe(await fakeHash('a-different-password'));
    expect(repos.products.list({})).toHaveLength(7);
    expect(repos.categories.list()).toHaveLength(4);
    expect(fs.readdirSync(uploadDir).sort()).toEqual(filesAfterFirst);
  });

  it('skips the catalogue (and its validation) when any product exists', async () => {
    repos.products.create({
      slug: 'hand-made',
      name: 'Hand Made',
      description: '',
      priceCents: 100,
      categoryId: null,
      colours: [],
      sizes: [],
      amazonUrl: 'https://amazon.com/dp/X',
      featured: false,
      status: 'draft',
    });
    const broken = writeCatalogue([fixtureProduct({ amazonUrl: 'https://evil.example/' })]);
    const result = await seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: broken });
    expect(result.catalogueSeeded).toBe(false);
    expect(repos.admins.getByEmail(admin.email)).not.toBeNull();
    expect(repos.products.list({})).toHaveLength(1);
  });
});

describe('seedDatabase with fixture catalogues (DB-005)', () => {
  it('seeds a valid fixture: hex uppercased, sizes in canonical order, extension from magic bytes', async () => {
    const dir = writeCatalogue(
      [
        fixtureProduct({
          featured: true,
          images: [
            { file: 'a.jpg', alt: 'Front' },
            { file: 'looks-like.jpg', alt: 'Back' },
            { file: 'c.webp', alt: 'Detail' },
          ],
        }),
      ],
      { 'a.jpg': JPEG, 'looks-like.jpg': PNG, 'c.webp': WEBP },
    );
    const result = await seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir });
    expect(result).toMatchObject({ catalogueSeeded: true, categoriesSeeded: 1, productsCreated: 1 });

    const p = repos.products.getBySlug('fixture-tee')!;
    expect(p.colours).toEqual([{ name: 'Black', hex: '#1E212A' }]);
    expect(p.sizes).toEqual(['S', 'M', 'XL']);
    expect(p.featured).toBe(true);
    expect(p.description).toBe('A test shirt.\nSecond paragraph.');
    const images = repos.images.listForProduct(p.id);
    expect(images.map((i) => i.alt)).toEqual(['Front', 'Back', 'Detail']);
    expect(images.map((i) => path.extname(i.filename))).toEqual(['.jpg', '.png', '.webp']);
  });

  const invalidCases: [string, FixtureProduct[], RegExp][] = [
    ['missing name', [fixtureProduct({ name: undefined })], /product "fixture-tee" field "name"/],
    ['bad slug', [fixtureProduct({ slug: 'Bad Slug' })], /products\[1\] field "slug"/],
    ['unknown category', [fixtureProduct({ category: 'nope' })], /product "fixture-tee" field "category"/],
    ['bad size', [fixtureProduct({ sizes: ['M', 'XXXL'] })], /product "fixture-tee" field "sizes"/],
    ['duplicate size', [fixtureProduct({ sizes: ['M', 'M'] })], /product "fixture-tee" field "sizes"/],
    ['bad hex', [fixtureProduct({ colours: [{ name: 'Red', hex: 'red' }] })], /field "colours\[0\]"\.hex/],
    ['fractional price', [fixtureProduct({ priceCents: 39.95 })], /field "priceCents"/],
    ['negative price', [fixtureProduct({ priceCents: -1 })], /field "priceCents"/],
    ['price too high', [fixtureProduct({ priceCents: 1_000_001 })], /field "priceCents"/],
    ['string featured', [fixtureProduct({ featured: 'yes' })], /field "featured"/],
    [
      'too many images',
      [fixtureProduct({ images: Array.from({ length: 9 }, () => ({ file: 'a.jpg', alt: 'x' })) })],
      /field "images" has more than 8/,
    ],
    ['image path traversal', [fixtureProduct({ images: [{ file: '../products.json', alt: 'x' }] })], /images\[0\]"\.file/],
    ['empty alt', [fixtureProduct({ images: [{ file: 'a.jpg', alt: '' }] })], /images\[0\]"\.alt/],
    ['duplicate slug', [fixtureProduct(), fixtureProduct()], /product "fixture-tee" field "slug" is used twice/],
    [
      'same image listed twice',
      [fixtureProduct({ images: [{ file: 'a.jpg', alt: 'x' }, { file: 'a.jpg', alt: 'y' }] })],
      /product "fixture-tee" field "images": a\.jpg is listed twice/,
    ],
  ];

  it.each(invalidCases)('%s: throws naming the product and field, writes nothing', async (_label, products, message) => {
    // A valid product first, so a non-atomic seed would have written something.
    const dir = writeCatalogue([fixtureProduct({ slug: 'good-tee' }), ...products]);
    const err = await seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogueError);
    expect((err as Error).message).toMatch(message);
    expectNothingWritten();
  });

  it('malformed JSON throws and writes nothing', async () => {
    const dir = writeCatalogue([]);
    fs.writeFileSync(path.join(dir, 'products.json'), '{ "categories": [');
    await expect(seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir })).rejects.toThrow(
      /cannot read products\.json/,
    );
    expectNothingWritten();
  });

  it('a missing image throws naming the product and file, and writes nothing', async () => {
    const dir = writeCatalogue([
      fixtureProduct({ slug: 'good-tee' }),
      fixtureProduct({ images: [{ file: 'gone.jpg', alt: 'Gone' }] }),
    ]);
    await expect(seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir })).rejects.toThrow(
      /product "fixture-tee" field "images\[0\]"\.file: images\/gone\.jpg is missing/,
    );
    expectNothingWritten();
  });

  it('an image that is not JPEG/PNG/WebP throws and writes nothing', async () => {
    const dir = writeCatalogue([fixtureProduct({ images: [{ file: 'evil.jpg', alt: 'x' }] })], {
      'evil.jpg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });
    await expect(seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir })).rejects.toThrow(
      /images\/evil\.jpg is not a JPEG, PNG or WebP image/,
    );
    expectNothingWritten();
  });

  it.each([
    'https://evil.example/dp/B0TEST0001',
    'http://www.amazon.com.au/dp/B0TEST0001',
    'https://www.amazon.com.au.evil.example/dp/X',
    'javascript:alert(1)',
  ])('a non-Amazon URL (%s) throws and writes nothing', async (amazonUrl) => {
    const dir = writeCatalogue([fixtureProduct({ amazonUrl })]);
    await expect(seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir })).rejects.toThrow(
      /product "fixture-tee" field "amazonUrl" must be null or an https link to Amazon/,
    );
    expectNothingWritten();
  });

  it('a failure midway rolls back every row and removes copied files', async () => {
    const dir = writeCatalogue([
      fixtureProduct({ slug: 'first-tee' }),
      fixtureProduct({ slug: 'second-tee' }),
      fixtureProduct({ slug: 'third-tee' }),
    ]);
    db.exec(`CREATE TRIGGER fail_third BEFORE INSERT ON products WHEN NEW.slug = 'third-tee'
             BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);

    await expect(seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir })).rejects.toThrow(
      /simulated failure/,
    );
    expectNothingWritten();
    expect(db.isTransaction).toBe(false);

    db.exec('DROP TRIGGER fail_third');
    const retry = await seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir });
    expect(retry.productsCreated).toBe(3);
    expect(fs.readdirSync(uploadDir)).toHaveLength(3);
  });

  it('second run with a fixture is a no-op', async () => {
    const dir = writeCatalogue([fixtureProduct()]);
    await seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir });
    const second = await seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir });
    expect(second.catalogueSeeded).toBe(false);
    expect(repos.products.list({})).toHaveLength(1);
    expect(fs.readdirSync(uploadDir)).toHaveLength(1);
  });
});

describe('seedDatabase without an admin (DB-006)', () => {
  it('admin null: no admins row, hashPassword never called, catalogue fully seeded', async () => {
    const hash = vi.fn(fakeHash);
    const result = await seedDatabase(db, uploadDir, null, hash);
    expect(hash).not.toHaveBeenCalled();
    expect(result).toMatchObject({ adminId: null, catalogueSeeded: true, categoriesSeeded: 4, productsCreated: 7 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM admins').get()).toEqual({ n: 0 });
    expect(repos.products.list({ status: 'published' })).toHaveLength(7);
    expect(fs.readdirSync(uploadDir)).toHaveLength(7);
  });

  it('a second call with admin null is a no-op', async () => {
    await seedDatabase(db, uploadDir, null, fakeHash);
    const files = fs.readdirSync(uploadDir).sort();
    const second = await seedDatabase(db, uploadDir, null, fakeHash);
    expect(second).toMatchObject({ adminId: null, catalogueSeeded: false, productsCreated: 0, imagesWritten: [] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM admins').get()).toEqual({ n: 0 });
    expect(repos.products.list({})).toHaveLength(7);
    expect(fs.readdirSync(uploadDir).sort()).toEqual(files);
  });

  it('admin null with an invalid catalogue still throws and writes nothing', async () => {
    const dir = writeCatalogue([fixtureProduct({ amazonUrl: 'https://evil.example/' })]);
    await expect(seedDatabase(db, uploadDir, null, fakeHash, { catalogueDir: dir })).rejects.toThrow(/amazonUrl/);
    expectNothingWritten();
  });

  it('admin null: a failure midway rolls back and removes copied files', async () => {
    const dir = writeCatalogue([fixtureProduct({ slug: 'first-tee' }), fixtureProduct({ slug: 'second-tee' })]);
    db.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON products WHEN NEW.slug = 'second-tee'
             BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);
    await expect(seedDatabase(db, uploadDir, null, fakeHash, { catalogueDir: dir })).rejects.toThrow(/simulated/);
    expectNothingWritten();
  });
});

describe('deterministic seed image names (DB-007)', () => {
  const NAME = /^[0-9a-f]{32}\.(jpg|png|webp)$/;

  function urlsBySlug(r: Repositories): Record<string, string[]> {
    return Object.fromEntries(r.products.list({}).map((p) => [p.slug, p.images.map((i) => i.url)]));
  }

  it('two seeds into separate databases and upload dirs give identical names and URLs', async () => {
    const otherDb = openDatabase(':memory:');
    const otherUploads = path.join(tmp, 'uploads-b');
    try {
      await seedDatabase(db, uploadDir, null, fakeHash);
      await seedDatabase(otherDb, otherUploads, null, fakeHash);

      const a = fs.readdirSync(uploadDir).sort();
      expect(a).toHaveLength(7);
      for (const name of a) expect(name).toMatch(NAME);
      expect(fs.readdirSync(otherUploads).sort()).toEqual(a);

      const urlsA = urlsBySlug(repos);
      expect(Object.keys(urlsA)).toHaveLength(7);
      expect(urlsBySlug(createRepositories(otherDb))).toEqual(urlsA);
    } finally {
      otherDb.close();
    }
  });

  it('fixture names follow the extension from magic bytes and differ per product', async () => {
    const dir = writeCatalogue(
      [
        fixtureProduct({ slug: 'one-tee', images: [{ file: 'a.jpg', alt: 'a' }, { file: 'b.jpg', alt: 'b' }] }),
        fixtureProduct({ slug: 'two-tee', images: [{ file: 'a.jpg', alt: 'a' }] }),
      ],
      { 'a.jpg': JPEG, 'b.jpg': PNG },
    );
    await seedDatabase(db, uploadDir, null, fakeHash, { catalogueDir: dir });
    const one = repos.images.listForProduct(repos.products.getBySlug('one-tee')!.id).map((i) => i.filename);
    const two = repos.images.listForProduct(repos.products.getBySlug('two-tee')!.id).map((i) => i.filename);
    expect(one).toEqual([seedImageFilename('one-tee', 'a.jpg', JPEG, 'jpg'), seedImageFilename('one-tee', 'b.jpg', PNG, 'png')]);
    expect(two).toEqual([seedImageFilename('two-tee', 'a.jpg', JPEG, 'jpg')]);
    expect(one[1]).toMatch(/\.png$/);
    expect(two[0]).not.toBe(one[0]);
    expect(fs.readdirSync(uploadDir)).toHaveLength(3);
  });

  it('re-seeding a fresh database into an upload dir that already has identical files succeeds', async () => {
    await seedDatabase(db, uploadDir, null, fakeHash);
    const before = fs.readdirSync(uploadDir).sort();

    const freshDb = openDatabase(':memory:');
    try {
      const result = await seedDatabase(freshDb, uploadDir, null, fakeHash);
      expect(result).toMatchObject({ catalogueSeeded: true, productsCreated: 7 });
      expect(result.imagesWritten).toHaveLength(7);
      expect(fs.readdirSync(uploadDir).sort()).toEqual(before);
      expect(urlsBySlug(createRepositories(freshDb))).toEqual(urlsBySlug(repos));
    } finally {
      freshDb.close();
    }
  });

  it('an existing file with different bytes fails, is left untouched, and nothing is written', async () => {
    const dir = writeCatalogue([fixtureProduct({ slug: 'good-tee' }), fixtureProduct()]);
    const clash = seedImageFilename('fixture-tee', 'a.jpg', JPEG, 'jpg');
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, clash), 'not the same bytes');

    await expect(seedDatabase(db, uploadDir, admin, fakeHash, { catalogueDir: dir })).rejects.toThrow(
      /already exists in the upload dir with different contents/,
    );
    expect(fs.readdirSync(uploadDir)).toEqual([clash]);
    expect(fs.readFileSync(path.join(uploadDir, clash), 'utf8')).toBe('not the same bytes');
    expect(repos.admins.getByEmail(admin.email)).toBeNull();
    expect(repos.products.list({})).toEqual([]);
    expect(repos.categories.list()).toEqual([]);
  });

  it('a failure midway removes only files this run created, not identical pre-existing ones', async () => {
    const dir = writeCatalogue(
      [
        fixtureProduct({ slug: 'first-tee' }),
        fixtureProduct({ slug: 'second-tee' }),
        fixtureProduct({ slug: 'third-tee' }),
      ],
      { 'a.jpg': JPEG },
    );
    const preExisting = seedImageFilename('first-tee', 'a.jpg', JPEG, 'jpg');
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, preExisting), JPEG);
    db.exec(`CREATE TRIGGER fail_third BEFORE INSERT ON products WHEN NEW.slug = 'third-tee'
             BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);

    await expect(seedDatabase(db, uploadDir, null, fakeHash, { catalogueDir: dir })).rejects.toThrow(/simulated/);
    expect(fs.readdirSync(uploadDir)).toEqual([preExisting]);
    expect(repos.products.list({})).toEqual([]);
  });
});

describe('loadCatalogue', () => {
  it('validates the real catalogue without writing anything', () => {
    const catalogue = loadCatalogue();
    expect(catalogue.categories).toHaveLength(4);
    expect(catalogue.products).toHaveLength(7);
    expect(catalogue.products.flatMap((p) => p.images).every((i) => i.ext === 'jpg')).toBe(true);
  });
});

// `npm run seed`: upserts the admin account and, only when the products table
// is empty, loads the real catalogue from catalogue/products.json, copying its
// images from catalogue/images/ into UPLOAD_DIR under deterministic names
// (see seedImageFilename), so every instance seeded from the same catalogue
// serves the same image URLs.
//
// The whole catalogue (JSON and image bytes) is validated before anything is
// written. The writes then run in one transaction; on failure the transaction
// is rolled back and any image files already copied are removed.
//
// seedDatabase also accepts admin = null (read-only deployments with no admin
// panel): the catalogue is seeded the same way and no admin row is touched.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { CategoryWrite } from '../../contracts/modules';
import { SIZES, type Colour, type Size } from '../../contracts/types';
import { isAllowedAmazonUrl } from '../security/index';
import { loadConfig, loadSeedAdmin } from '../shared/config';
import { createRepositories, openDatabase } from './index';

/** catalogue/ at the project root, independent of the cwd. */
export const DEFAULT_CATALOGUE_DIR = fileURLToPath(new URL('../../catalogue/', import.meta.url));
export const MAX_IMAGES_PER_PRODUCT = 8;

/* ------------------------------------------------------------------ */
/* Catalogue loading and validation                                    */
/* ------------------------------------------------------------------ */

type ImageExt = 'jpg' | 'png' | 'webp';

export interface CatalogueImage {
  file: string;
  alt: string;
  ext: ImageExt;
  bytes: Buffer;
  /** Name in uploadDir, from seedImageFilename. */
  filename: string;
}

export interface CatalogueProduct {
  slug: string;
  name: string;
  categorySlug: string;
  description: string;
  priceCents: number;
  colours: Colour[];
  sizes: Size[];
  amazonUrl: string | null; // null => no Amazon listing yet
  featured: boolean;
  images: CatalogueImage[];
}

export interface Catalogue {
  categories: CategoryWrite[];
  products: CatalogueProduct[];
}

export class CatalogueError extends Error {
  constructor(message: string) {
    super(`Invalid catalogue: ${message}`);
    this.name = 'CatalogueError';
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** A plain file name inside catalogue/images: no separators, no leading dot. */
const IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function detectImageType(buf: Buffer): ImageExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

/**
 * First 32 hex chars of sha256(productSlug + "\0" + imageFile + "\0" + fileBytes), plus the
 * extension. Stable across runs and instances, and unguessable without the file itself.
 */
export function seedImageFilename(productSlug: string, imageFile: string, bytes: Buffer, ext: ImageExt): string {
  const digest = crypto
    .createHash('sha256')
    .update(productSlug, 'utf8')
    .update('\0')
    .update(imageFile, 'utf8')
    .update('\0')
    .update(bytes)
    .digest('hex');
  return `${digest.slice(0, 32)}.${ext}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(obj: Record<string, unknown>, key: string, where: string, min: number, max: number): string {
  const v = obj[key];
  if (typeof v !== 'string') throw new CatalogueError(`${where} field "${key}" must be a string`);
  if (v.trim().length < min || v.length > max) {
    throw new CatalogueError(`${where} field "${key}" must be ${min}-${max} characters`);
  }
  return v;
}

function int(obj: Record<string, unknown>, key: string, where: string, min: number, max: number): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new CatalogueError(`${where} field "${key}" must be an integer from ${min} to ${max}`);
  }
  return v;
}

function slug(obj: Record<string, unknown>, key: string, where: string): string {
  const v = str(obj, key, where, 1, 80);
  if (!SLUG.test(v)) throw new CatalogueError(`${where} field "${key}" must be a lowercase-hyphenated slug`);
  return v;
}

function arr(obj: Record<string, unknown>, key: string, where: string, max: number): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) throw new CatalogueError(`${where} field "${key}" must be an array`);
  if (v.length > max) throw new CatalogueError(`${where} field "${key}" has more than ${max} entries`);
  return v;
}

function parseCategory(raw: unknown, index: number): CategoryWrite {
  const where = `categories[${index}]`;
  if (!isRecord(raw)) throw new CatalogueError(`${where} must be an object`);
  const s = slug(raw, 'slug', where);
  const named = `category "${s}"`;
  return { slug: s, name: str(raw, 'name', named, 1, 60), sortOrder: int(raw, 'sortOrder', named, -1000, 1000) };
}

function readImage(raw: unknown, index: number, productSlug: string, where: string, imagesDir: string): CatalogueImage {
  const at = `${where} field "images[${index}]"`;
  if (!isRecord(raw)) throw new CatalogueError(`${at} must be an object`);
  const file = raw.file;
  if (typeof file !== 'string' || !IMAGE_FILE.test(file)) {
    throw new CatalogueError(`${at}.file must be a plain file name inside catalogue/images`);
  }
  const alt = raw.alt;
  if (typeof alt !== 'string' || alt.trim().length === 0 || alt.length > 200) {
    throw new CatalogueError(`${at}.alt must be 1-200 characters`);
  }
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(imagesDir, file));
  } catch {
    throw new CatalogueError(`${at}.file: images/${file} is missing or unreadable`);
  }
  const ext = detectImageType(bytes);
  if (!ext) throw new CatalogueError(`${at}.file: images/${file} is not a JPEG, PNG or WebP image`);
  return { file, alt, ext, bytes, filename: seedImageFilename(productSlug, file, bytes, ext) };
}

function parseProduct(raw: unknown, index: number, categorySlugs: Set<string>, imagesDir: string): CatalogueProduct {
  if (!isRecord(raw)) throw new CatalogueError(`products[${index}] must be an object`);
  const s = slug(raw, 'slug', `products[${index}]`);
  const where = `product "${s}"`;

  const name = str(raw, 'name', where, 1, 120);
  const categorySlug = slug(raw, 'category', where);
  if (!categorySlugs.has(categorySlug)) {
    throw new CatalogueError(`${where} field "category": no category with slug "${categorySlug}"`);
  }
  const description = str(raw, 'description', where, 0, 4000);
  const priceCents = int(raw, 'priceCents', where, 0, 1_000_000);

  const colours = arr(raw, 'colours', where, 12).map((c, i): Colour => {
    const at = `${where} field "colours[${i}]"`;
    if (!isRecord(c)) throw new CatalogueError(`${at} must be an object`);
    const colourName = c.name;
    if (typeof colourName !== 'string' || colourName.trim().length === 0 || colourName.length > 40) {
      throw new CatalogueError(`${at}.name must be 1-40 characters`);
    }
    if (typeof c.hex !== 'string' || !HEX.test(c.hex)) throw new CatalogueError(`${at}.hex must look like #RRGGBB`);
    return { name: colourName, hex: c.hex.toUpperCase() };
  });

  const sizeList = arr(raw, 'sizes', where, SIZES.length);
  for (const size of sizeList) {
    if (!(SIZES as readonly unknown[]).includes(size)) {
      throw new CatalogueError(`${where} field "sizes": ${JSON.stringify(size)} is not one of ${SIZES.join(', ')}`);
    }
  }
  if (new Set(sizeList).size !== sizeList.length) throw new CatalogueError(`${where} field "sizes" has duplicates`);
  const sizes = SIZES.filter((size) => sizeList.includes(size));

  const amazonUrl = raw.amazonUrl;
  if (amazonUrl !== null && (typeof amazonUrl !== 'string' || !isAllowedAmazonUrl(amazonUrl))) {
    throw new CatalogueError(`${where} field "amazonUrl" must be null or an https link to Amazon`);
  }
  if (typeof raw.featured !== 'boolean') throw new CatalogueError(`${where} field "featured" must be true or false`);

  const images = arr(raw, 'images', where, MAX_IMAGES_PER_PRODUCT).map((img, i) =>
    readImage(img, i, s, where, imagesDir),
  );
  const files = new Set<string>();
  for (const image of images) {
    if (files.has(image.file)) throw new CatalogueError(`${where} field "images": ${image.file} is listed twice`);
    files.add(image.file);
  }

  return { slug: s, name, categorySlug, description, priceCents, colours, sizes, amazonUrl, featured: raw.featured, images };
}

/**
 * Reads and fully validates <dir>/products.json and every image it references.
 * Writes nothing. @throws CatalogueError naming the product (or category) and field.
 */
export function loadCatalogue(dir: string = DEFAULT_CATALOGUE_DIR): Catalogue {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(path.join(dir, 'products.json'), 'utf8'));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CatalogueError(`cannot read products.json in ${dir}: ${reason}`);
  }
  if (!isRecord(data)) throw new CatalogueError('products.json must contain an object');

  const categories = arr(data, 'categories', 'products.json', 1000).map(parseCategory);
  const categorySlugs = new Set<string>();
  for (const c of categories) {
    if (categorySlugs.has(c.slug)) throw new CatalogueError(`category "${c.slug}" field "slug" is used twice`);
    categorySlugs.add(c.slug);
  }

  const imagesDir = path.join(dir, 'images');
  const products = arr(data, 'products', 'products.json', 10_000).map((p, i) =>
    parseProduct(p, i, categorySlugs, imagesDir),
  );
  const productSlugs = new Set<string>();
  for (const p of products) {
    if (productSlugs.has(p.slug)) throw new CatalogueError(`product "${p.slug}" field "slug" is used twice`);
    productSlugs.add(p.slug);
  }
  return { categories, products };
}

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

export interface SeedOptions {
  /** Directory holding products.json and images/. Defaults to the project's catalogue/. */
  catalogueDir?: string;
}

export interface SeedResult {
  /** null when seeded without an admin (read-only deployments). */
  adminId: number | null;
  catalogueSeeded: boolean;
  /** Catalogue categories linked, whether created now or reused by slug. */
  categoriesSeeded: number;
  categoriesCreated: number;
  productsCreated: number;
  /** Absolute paths of the files backing the seeded image rows (new, or already present with identical bytes). */
  imagesWritten: string[];
}

/**
 * Writes the image under its deterministic name with 'wx'. An existing file with identical
 * bytes is accepted (re-seed into an existing upload dir); different bytes are an error.
 * Files this call creates are appended to `created`.
 */
function writeSeedImage(filePath: string, bytes: Buffer, productSlug: string, created: string[]): void {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    if (!fs.readFileSync(filePath).equals(bytes)) {
      throw new Error(
        `Seed image ${path.basename(filePath)} for product "${productSlug}" already exists in the upload dir with different contents`,
      );
    }
    return;
  }
  // Recorded as soon as we own the file, so a failed write is still cleaned up.
  created.push(filePath);
  try {
    fs.writeFileSync(fd, bytes);
  } finally {
    fs.closeSync(fd);
  }
}

function hasProducts(db: DatabaseSync): boolean {
  return db.prepare('SELECT 1 AS found FROM products LIMIT 1').get() !== undefined;
}

export async function seedDatabase(
  db: DatabaseSync,
  uploadDir: string,
  /** null skips the password hash and admin upsert entirely (e.g. a read-only showcase deployment). */
  admin: { email: string; password: string } | null,
  hashPassword: (plain: string) => Promise<string>,
  options: SeedOptions = {},
): Promise<SeedResult> {
  // Validate before any write, so a bad catalogue leaves the database untouched.
  const catalogue = hasProducts(db) ? null : loadCatalogue(options.catalogueDir);
  const passwordHash = admin ? await hashPassword(admin.password) : null;

  const repos = createRepositories(db);
  const result: SeedResult = {
    adminId: null,
    catalogueSeeded: false,
    categoriesSeeded: 0,
    categoriesCreated: 0,
    productsCreated: 0,
    imagesWritten: [],
  };

  const createdFiles: string[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    if (admin && passwordHash !== null) result.adminId = repos.admins.upsert(admin.email, passwordHash).id;

    // Re-check under the write lock in case another process seeded first.
    if (catalogue && !hasProducts(db)) {
      fs.mkdirSync(uploadDir, { recursive: true });

      const categoryIds = new Map<string, number>();
      for (const cat of catalogue.categories) {
        const existing = repos.categories.getBySlug(cat.slug);
        if (!existing) result.categoriesCreated += 1;
        categoryIds.set(cat.slug, (existing ?? repos.categories.create(cat)).id);
      }
      result.categoriesSeeded = catalogue.categories.length;

      for (const item of catalogue.products) {
        const product = repos.products.create({
          slug: item.slug,
          name: item.name,
          description: item.description,
          priceCents: item.priceCents,
          categoryId: categoryIds.get(item.categorySlug) ?? null,
          colours: item.colours,
          sizes: item.sizes,
          amazonUrl: item.amazonUrl,
          featured: item.featured,
          status: 'published',
        });
        result.productsCreated += 1;

        for (const image of item.images) {
          const filePath = path.join(uploadDir, image.filename);
          writeSeedImage(filePath, image.bytes, item.slug, createdFiles);
          result.imagesWritten.push(filePath);
          repos.images.create({ productId: product.id, filename: image.filename, alt: image.alt });
        }
      }
      result.catalogueSeeded = true;
    }
    db.exec('COMMIT');
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    // Only files this run created; identical files that were already there stay.
    for (const filePath of createdFiles) fs.rmSync(filePath, { force: true });
    throw err;
  }
  return result;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const admin = loadSeedAdmin();
  // Imported lazily so seedDatabase stays testable without the auth layer.
  const { hashPassword } = await import('../auth/index');
  const db = openDatabase(config.databaseFile);
  try {
    const result = await seedDatabase(db, config.uploadDir, admin, hashPassword);
    console.log(`Admin account upserted (id ${result.adminId}).`);
    console.log(
      result.catalogueSeeded
        ? `Catalogue seeded: ${result.categoriesSeeded} categories (${result.categoriesCreated} new), ` +
            `${result.productsCreated} products, ${result.imagesWritten.length} images in ${config.uploadDir}.`
        : 'Products already exist; catalogue left unchanged.',
    );
  } finally {
    db.close();
  }
}

function isRunDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isRunDirectly()) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

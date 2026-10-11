// Repository implementations for contracts/modules.ts. Every statement is a
// constant SQL string with bound parameters; values are never spliced into SQL.
import type { DatabaseSync } from 'node:sqlite';
import {
  UniqueViolationError,
  type AdminRecord,
  type AdminRepo,
  type CategoryRepo,
  type CategoryWrite,
  type ImageRepo,
  type ProductQuery,
  type ProductRepo,
  type ProductWrite,
  type Repositories,
  type SessionRecord,
  type SessionRepo,
  type StoredImage,
} from '../../contracts/modules';
import {
  SIZES,
  type AdminProduct,
  type AdminUser,
  type Category,
  type Colour,
  type ProductImage,
  type ProductStatus,
  type Size,
} from '../../contracts/types';

/* ------------------------------------------------------------------ */
/* Row shapes (snake_case, as stored)                                  */
/* ------------------------------------------------------------------ */

interface CategoryRow {
  id: number;
  slug: string;
  name: string;
  sort_order: number;
}

interface ProductRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  price_cents: number;
  category_id: number | null;
  colours_json: string;
  sizes_json: string;
  amazon_url: string | null;
  featured: number;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
  category_slug: string | null;
  category_name: string | null;
}

interface ImageRow {
  id: number;
  product_id: number;
  filename: string;
  alt: string;
  sort_order: number;
}

interface AdminRow {
  id: number;
  email: string;
  password_hash: string;
}

interface SessionRow {
  token_hash: string;
  admin_id: number;
  expires_at: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const SQLITE_CONSTRAINT_UNIQUE = 2067;
const UNIQUE_FIELDS = new Set(['slug', 'email', 'filename']);

/** Converts a SQLite UNIQUE failure on slug/email/filename into UniqueViolationError; rethrows anything else. */
function rethrowUnique(err: unknown): never {
  if (err instanceof Error && (err as { errcode?: number }).errcode === SQLITE_CONSTRAINT_UNIQUE) {
    const column = /UNIQUE constraint failed: \w+\.(\w+)/.exec(err.message)?.[1];
    if (column && UNIQUE_FIELDS.has(column)) {
      throw new UniqueViolationError(column as UniqueViolationError['field']);
    }
  }
  throw err;
}

function normaliseColours(colours: Colour[]): Colour[] {
  return colours.map((c) => ({ name: c.name, hex: c.hex.toUpperCase() }));
}

function normaliseSizes(sizes: readonly string[]): Size[] {
  const present = new Set(sizes);
  return SIZES.filter((s) => present.has(s));
}

function toCategory(row: CategoryRow): Category {
  return { id: row.id, slug: row.slug, name: row.name, sortOrder: row.sort_order };
}

function toStoredImage(row: ImageRow): StoredImage {
  return {
    id: row.id,
    productId: row.product_id,
    filename: row.filename,
    url: `/uploads/${row.filename}`,
    alt: row.alt,
    sortOrder: row.sort_order,
  };
}

/** Public image shape only: filename and productId stay inside the database layer. */
function toProductImage(row: ImageRow): ProductImage {
  return { id: row.id, url: `/uploads/${row.filename}`, alt: row.alt, sortOrder: row.sort_order };
}

/** `images` must already be ordered by sort_order, id. */
function toAdminProduct(row: ProductRow, images: ImageRow[]): AdminProduct {
  const mapped = images.map(toProductImage);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    priceCents: row.price_cents,
    currency: 'AUD',
    category:
      row.category_id !== null && row.category_slug !== null && row.category_name !== null
        ? { slug: row.category_slug, name: row.category_name }
        : null,
    primaryImage: mapped[0] ?? null,
    colours: normaliseColours(JSON.parse(row.colours_json) as Colour[]),
    featured: row.featured === 1,
    description: row.description,
    sizes: normaliseSizes(JSON.parse(row.sizes_json) as string[]),
    images: mapped,
    amazonUrl: row.amazon_url,
    categoryId: row.category_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

function categoryRepo(db: DatabaseSync): CategoryRepo {
  const listStmt = db.prepare('SELECT id, slug, name, sort_order FROM categories ORDER BY sort_order, name, id');
  const byIdStmt = db.prepare('SELECT id, slug, name, sort_order FROM categories WHERE id = ?');
  const bySlugStmt = db.prepare('SELECT id, slug, name, sort_order FROM categories WHERE slug = ?');
  const insertStmt = db.prepare(
    'INSERT INTO categories (slug, name, sort_order) VALUES (?, ?, ?) RETURNING id, slug, name, sort_order',
  );
  const updateStmt = db.prepare(
    'UPDATE categories SET slug = ?, name = ?, sort_order = ? WHERE id = ? RETURNING id, slug, name, sort_order',
  );
  const deleteStmt = db.prepare('DELETE FROM categories WHERE id = ?');

  return {
    list: () => (listStmt.all() as unknown as CategoryRow[]).map(toCategory),
    getById(id) {
      const row = byIdStmt.get(id) as unknown as CategoryRow | undefined;
      return row ? toCategory(row) : null;
    },
    getBySlug(slug) {
      const row = bySlugStmt.get(slug) as unknown as CategoryRow | undefined;
      return row ? toCategory(row) : null;
    },
    create(data: CategoryWrite) {
      try {
        return toCategory(insertStmt.get(data.slug, data.name, data.sortOrder) as unknown as CategoryRow);
      } catch (err) {
        rethrowUnique(err);
      }
    },
    update(id, data) {
      try {
        const row = updateStmt.get(data.slug, data.name, data.sortOrder, id) as unknown as CategoryRow | undefined;
        return row ? toCategory(row) : null;
      } catch (err) {
        rethrowUnique(err);
      }
    },
    delete: (id) => deleteStmt.run(id).changes > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

const PRODUCT_SELECT = `
  SELECT p.id, p.slug, p.name, p.description, p.price_cents, p.category_id,
         p.colours_json, p.sizes_json, p.amazon_url, p.featured, p.status,
         p.created_at, p.updated_at,
         c.slug AS category_slug, c.name AS category_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id`;

const IMAGE_COLUMNS = 'id, product_id, filename, alt, sort_order';

function productRepo(db: DatabaseSync): ProductRepo {
  const listStmt = db.prepare(`${PRODUCT_SELECT}
    WHERE (:status IS NULL OR p.status = :status)
      AND (:category_slug IS NULL OR c.slug = :category_slug)
      AND (:featured IS NULL OR p.featured = :featured)
    ORDER BY p.featured DESC, p.created_at DESC, p.id DESC`);
  const byIdStmt = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`);
  const bySlugStmt = db.prepare(`${PRODUCT_SELECT} WHERE p.slug = ?`);
  const imagesForOneStmt = db.prepare(
    `SELECT ${IMAGE_COLUMNS} FROM product_images WHERE product_id = ? ORDER BY sort_order, id`,
  );
  // One query for the images of every listed product (ids passed as a JSON array).
  const imagesForManyStmt = db.prepare(
    `SELECT ${IMAGE_COLUMNS} FROM product_images
     WHERE product_id IN (SELECT value FROM json_each(?))
     ORDER BY product_id, sort_order, id`,
  );
  const insertStmt = db.prepare(`
    INSERT INTO products (slug, name, description, price_cents, category_id, colours_json, sizes_json,
                          amazon_url, featured, status)
    VALUES (:slug, :name, :description, :price_cents, :category_id, :colours_json, :sizes_json,
            :amazon_url, :featured, :status)
    RETURNING id`);
  const updateStmt = db.prepare(`
    UPDATE products SET slug = :slug, name = :name, description = :description, price_cents = :price_cents,
      category_id = :category_id, colours_json = :colours_json, sizes_json = :sizes_json,
      amazon_url = :amazon_url, featured = :featured, status = :status,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = :id`);
  const deleteStmt = db.prepare('DELETE FROM products WHERE id = ?');

  function writeParams(data: ProductWrite) {
    return {
      slug: data.slug,
      name: data.name,
      description: data.description,
      price_cents: data.priceCents,
      category_id: data.categoryId,
      colours_json: JSON.stringify(normaliseColours(data.colours)),
      sizes_json: JSON.stringify(normaliseSizes(data.sizes)),
      amazon_url: data.amazonUrl,
      featured: data.featured ? 1 : 0,
      status: data.status,
    };
  }

  function withImages(row: ProductRow | undefined): AdminProduct | null {
    if (!row) return null;
    return toAdminProduct(row, imagesForOneStmt.all(row.id) as unknown as ImageRow[]);
  }

  function getById(id: number): AdminProduct | null {
    return withImages(byIdStmt.get(id) as unknown as ProductRow | undefined);
  }

  return {
    list(query: ProductQuery) {
      const rows = listStmt.all({
        status: query.status ?? null,
        category_slug: query.categorySlug ?? null,
        featured: query.featured === undefined ? null : query.featured ? 1 : 0,
      }) as unknown as ProductRow[];
      if (rows.length === 0) return [];

      const images = imagesForManyStmt.all(JSON.stringify(rows.map((r) => r.id))) as unknown as ImageRow[];
      const byProduct = new Map<number, ImageRow[]>();
      for (const img of images) {
        const bucket = byProduct.get(img.product_id);
        if (bucket) bucket.push(img);
        else byProduct.set(img.product_id, [img]);
      }
      return rows.map((row) => toAdminProduct(row, byProduct.get(row.id) ?? []));
    },
    getById,
    getBySlug: (slug) => withImages(bySlugStmt.get(slug) as unknown as ProductRow | undefined),
    create(data) {
      let id: number;
      try {
        id = (insertStmt.get(writeParams(data)) as unknown as { id: number }).id;
      } catch (err) {
        rethrowUnique(err);
      }
      return getById(id)!;
    },
    update(id, data) {
      let changed: boolean;
      try {
        changed = updateStmt.run({ ...writeParams(data), id }).changes > 0;
      } catch (err) {
        rethrowUnique(err);
      }
      return changed ? getById(id) : null;
    },
    delete: (id) => deleteStmt.run(id).changes > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

function imageRepo(db: DatabaseSync): ImageRepo {
  const listStmt = db.prepare(
    `SELECT ${IMAGE_COLUMNS} FROM product_images WHERE product_id = ? ORDER BY sort_order, id`,
  );
  const getStmt = db.prepare(`SELECT ${IMAGE_COLUMNS} FROM product_images WHERE product_id = ? AND id = ?`);
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO product_images (product_id, filename, alt, sort_order)
    SELECT :product_id, :filename, :alt, COALESCE(MAX(sort_order) + 1, 0)
    FROM product_images WHERE product_id = :product_id
    RETURNING ${IMAGE_COLUMNS}`);
  const updateStmt = db.prepare(`
    UPDATE product_images
    SET alt = COALESCE(:alt, alt), sort_order = COALESCE(:sort_order, sort_order)
    WHERE product_id = :product_id AND id = :id
    RETURNING ${IMAGE_COLUMNS}`);
  const deleteStmt = db.prepare('DELETE FROM product_images WHERE product_id = ? AND id = ?');

  return {
    listForProduct: (productId) => (listStmt.all(productId) as unknown as ImageRow[]).map(toStoredImage),
    get(productId, imageId) {
      const row = getStmt.get(productId, imageId) as unknown as ImageRow | undefined;
      return row ? toStoredImage(row) : null;
    },
    countForProduct: (productId) => (countStmt.get(productId) as unknown as { n: number }).n,
    create(data) {
      try {
        const row = insertStmt.get({ product_id: data.productId, filename: data.filename, alt: data.alt });
        return toStoredImage(row as unknown as ImageRow);
      } catch (err) {
        rethrowUnique(err);
      }
    },
    update(productId, imageId, data) {
      const row = updateStmt.get({
        alt: data.alt ?? null,
        sort_order: data.sortOrder ?? null,
        product_id: productId,
        id: imageId,
      }) as unknown as ImageRow | undefined;
      return row ? toStoredImage(row) : null;
    },
    delete: (productId, imageId) => deleteStmt.run(productId, imageId).changes > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Admins                                                              */
/* ------------------------------------------------------------------ */

function adminRepo(db: DatabaseSync): AdminRepo {
  // admins.email is COLLATE NOCASE, so '=' is already case-insensitive.
  const byEmailStmt = db.prepare('SELECT id, email, password_hash FROM admins WHERE email = ?');
  const byIdStmt = db.prepare('SELECT id, email FROM admins WHERE id = ?');
  const upsertStmt = db.prepare(`
    INSERT INTO admins (email, password_hash) VALUES (?, ?)
    ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash
    RETURNING id, email`);

  return {
    getByEmail(email): AdminRecord | null {
      const row = byEmailStmt.get(email) as unknown as AdminRow | undefined;
      return row ? { id: row.id, email: row.email, passwordHash: row.password_hash } : null;
    },
    getById(id): AdminUser | null {
      const row = byIdStmt.get(id) as unknown as AdminUser | undefined;
      return row ? { id: row.id, email: row.email } : null;
    },
    upsert(email, passwordHash) {
      try {
        const row = upsertStmt.get(email, passwordHash) as unknown as AdminUser;
        return { id: row.id, email: row.email };
      } catch (err) {
        rethrowUnique(err);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function sessionRepo(db: DatabaseSync): SessionRepo {
  const insertStmt = db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)');
  const getStmt = db.prepare('SELECT token_hash, admin_id, expires_at FROM sessions WHERE token_hash = ?');
  const deleteStmt = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  // ISO-8601 UTC strings from toISOString() sort lexicographically in time order.
  const deleteExpiredStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  return {
    create(record: SessionRecord) {
      insertStmt.run(record.tokenHash, record.adminId, record.expiresAt.toISOString());
    },
    get(tokenHash) {
      const row = getStmt.get(tokenHash) as unknown as SessionRow | undefined;
      return row ? { tokenHash: row.token_hash, adminId: row.admin_id, expiresAt: new Date(row.expires_at) } : null;
    },
    delete(tokenHash) {
      deleteStmt.run(tokenHash);
    },
    deleteExpired: (now) => Number(deleteExpiredStmt.run(now.toISOString()).changes),
  };
}

export function buildRepositories(db: DatabaseSync): Repositories {
  return {
    categories: categoryRepo(db),
    products: productRepo(db),
    images: imageRepo(db),
    admins: adminRepo(db),
    sessions: sessionRepo(db),
  };
}

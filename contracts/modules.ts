// Contract version 5. In-process module boundaries between layers.
// READ ONLY for subagents. Each layer's index.ts must export exactly the
// functions named here, with these signatures. The composition root
// (src/app.ts, orchestrator-owned) wires them together.
//
// Import rule: a layer may import from contracts/**, src/shared/**, and the
// *index.ts* of another layer ONLY where this file says so. Never import a
// file inside another layer's folder.

import type { DatabaseSync } from 'node:sqlite';
import type { RequestHandler, Router } from 'express';
import type {
  AdminProduct,
  AdminUser,
  Category,
  Colour,
  ProductImage,
  ProductStatus,
  Size,
} from './types';
import type { AppConfig } from '../src/shared/config';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by auth's requireAdmin. Present on every /api/admin/** handler. */
      admin?: AdminUser;
    }
  }
}

/* ------------------------------------------------------------------ */
/* DATABASE layer: src/db/index.ts                                     */
/* ------------------------------------------------------------------ */

/** Thrown by repositories when a UNIQUE constraint fails. */
export class UniqueViolationError extends Error {
  constructor(public readonly field: 'slug' | 'email' | 'filename') {
    super(`Unique constraint failed on ${field}`);
    this.name = 'UniqueViolationError';
  }
}

export interface ProductQuery {
  status?: ProductStatus; // omitted => all statuses
  categorySlug?: string; // omitted => all categories; unknown slug => []
  featured?: boolean; // omitted => both
}

/** Fully validated data for a product write. slug is already final. */
export interface ProductWrite {
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  categoryId: number | null;
  colours: Colour[];
  sizes: Size[];
  amazonUrl: string | null;
  featured: boolean;
  status: ProductStatus;
}

export interface CategoryWrite {
  slug: string;
  name: string;
  sortOrder: number;
}

export interface CategoryRepo {
  /** Ordered by sortOrder, then name. */
  list(): Category[];
  getById(id: number): Category | null;
  getBySlug(slug: string): Category | null;
  /** @throws UniqueViolationError('slug') */
  create(data: CategoryWrite): Category;
  /** null if the id doesn't exist. @throws UniqueViolationError('slug') */
  update(id: number, data: CategoryWrite): Category | null;
  /** Products in it get category_id = NULL (FK ON DELETE SET NULL). */
  delete(id: number): boolean;
}

export interface ProductRepo {
  /** Ordered by featured DESC, created_at DESC, id DESC. Images included. */
  list(query: ProductQuery): AdminProduct[];
  getById(id: number): AdminProduct | null;
  getBySlug(slug: string): AdminProduct | null;
  /** @throws UniqueViolationError('slug') */
  create(data: ProductWrite): AdminProduct;
  /** Sets updated_at to now. null if the id doesn't exist. @throws UniqueViolationError('slug') */
  update(id: number, data: ProductWrite): AdminProduct | null;
  /** Image rows cascade. The caller removes image files first. */
  delete(id: number): boolean;
}

export interface StoredImage extends ProductImage {
  productId: number;
  filename: string;
}

export interface ImageRepo {
  listForProduct(productId: number): StoredImage[];
  get(productId: number, imageId: number): StoredImage | null;
  countForProduct(productId: number): number;
  /** sortOrder = (current max for the product) + 1, or 0 if none. @throws UniqueViolationError('filename') */
  create(data: { productId: number; filename: string; alt: string }): StoredImage;
  update(productId: number, imageId: number, data: { alt?: string; sortOrder?: number }): StoredImage | null;
  delete(productId: number, imageId: number): boolean;
}

export interface AdminRecord extends AdminUser {
  passwordHash: string;
}

export interface AdminRepo {
  /** Case-insensitive match. */
  getByEmail(email: string): AdminRecord | null;
  getById(id: number): AdminUser | null;
  /** Insert, or replace the password hash if the email exists. */
  upsert(email: string, passwordHash: string): AdminUser;
}

export interface SessionRecord {
  tokenHash: string;
  adminId: number;
  expiresAt: Date;
}

export interface SessionRepo {
  create(record: SessionRecord): void;
  get(tokenHash: string): SessionRecord | null;
  delete(tokenHash: string): void;
  /** Returns the number of rows removed. */
  deleteExpired(now: Date): number;
}

export interface Repositories {
  categories: CategoryRepo;
  products: ProductRepo;
  images: ImageRepo;
  admins: AdminRepo;
  sessions: SessionRepo;
}

export interface DbModule {
  /**
   * Opens (creating the parent directory if needed) the SQLite file, or
   * ":memory:", sets PRAGMA foreign_keys=ON and journal_mode=WAL (skipped
   * for :memory:), and applies pending migrations. Idempotent.
   */
  openDatabase(file: string): DatabaseSync;
  createRepositories(db: DatabaseSync): Repositories;
}

/**
 * Also in the database layer: src/db/seed.ts, run by `npm run seed`.
 * It may import { hashPassword } from src/auth/index.ts.
 */

/* ------------------------------------------------------------------ */
/* AUTH layer: src/auth/index.ts                                       */
/* ------------------------------------------------------------------ */

export interface AuthDeps {
  repos: Pick<Repositories, 'admins' | 'sessions'>;
  config: AppConfig;
}

export interface AuthModule {
  hashPassword(plain: string): Promise<string>;
  verifyPassword(plain: string, stored: string): Promise<boolean>;
  createAuth(deps: AuthDeps): {
    /** Mounted at /api/auth. Routes: POST /login, POST /logout, GET /me. */
    router: Router;
    requireAdmin: RequestHandler;
  };
}

/* ------------------------------------------------------------------ */
/* SECURITY layer: src/security/index.ts                               */
/* ------------------------------------------------------------------ */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface SecurityModule {
  /** CSP, nosniff, frame denial, referrer policy, etc. Applied to every response. */
  securityHeaders(config: AppConfig): RequestHandler;
  /** 403 CSRF_REJECTED for non-GET/HEAD/OPTIONS without X-Saltline-CSRF: 1. Mounted on /api. */
  csrfGuard(): RequestHandler;
  /**
   * In-memory, per-IP fixed window. 429 RATE_LIMITED with Retry-After.
   * Default for login: { windowMs: 15 min, max: 10 }.
   */
  rateLimiter(options: RateLimitOptions): RequestHandler;
  /** true only for https URLs on the allowed Amazon hosts (see openapi.yaml AmazonUrl). */
  isAllowedAmazonUrl(url: string): boolean;
}

/* ------------------------------------------------------------------ */
/* BACKEND layer: src/api/index.ts                                     */
/* ------------------------------------------------------------------ */

export interface ApiDeps {
  repos: Repositories;
  requireAdmin: RequestHandler;
  isAllowedAmazonUrl: (url: string) => boolean;
  config: AppConfig;
}

export interface ApiModule {
  /**
   * Mounted at /api, AFTER /api/auth. Contains /health, /categories,
   * /products, /products/:slug and everything under /admin. Applies
   * requireAdmin to /admin/** itself. Does not add a 404 fallback; the
   * glue does.
   */
  createApiRouter(deps: ApiDeps): Router;
}

// Contract version 5. Shared types for the HTTP API.
// READ ONLY for subagents. File a change request to alter anything here.
// Every JSON body crossing the API boundary uses exactly these shapes.

export type ISODateString = string; // e.g. "2026-10-06T12:00:00.000Z"

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
export type Size = (typeof SIZES)[number];

export type ProductStatus = 'draft' | 'published';
export type Currency = 'AUD';

export interface Colour {
  name: string; // 1–40 chars, e.g. "Harbour Blue"
  hex: string; // "#RRGGBB"
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  sortOrder: number;
}

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface ProductImage {
  id: number;
  url: string; // always "/uploads/<filename>"
  alt: string;
  sortOrder: number;
}

/** Card-sized view used in grids. Public. */
export interface ProductSummary {
  id: number;
  slug: string;
  name: string;
  priceCents: number;
  currency: Currency;
  category: CategoryRef | null;
  primaryImage: ProductImage | null; // lowest sortOrder image, or null
  colours: Colour[];
  featured: boolean;
}

/** Full product page view. Public, published products only. */
export interface Product extends ProductSummary {
  description: string; // plain text; newlines are paragraph breaks; never HTML
  sizes: Size[]; // always in SIZES order, no duplicates
  images: ProductImage[]; // ordered by sortOrder, then id
  amazonUrl: string | null; // null => not on Amazon yet; the site shows no Buy button
}

/** Admin view: every product regardless of status. */
export interface AdminProduct extends Product {
  categoryId: number | null;
  status: ProductStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** Body of POST /api/admin/products and PUT /api/admin/products/{id}. */
export interface ProductInput {
  name: string;
  slug?: string; // omitted or "" => generated from name
  description: string;
  priceCents: number;
  categoryId: number | null;
  colours: Colour[];
  sizes: Size[];
  amazonUrl: string | null; // null or "" => no Amazon link yet (stored as null)
  featured: boolean;
  status: ProductStatus;
}

/** Body of POST /api/admin/categories and PUT /api/admin/categories/{id}. */
export interface CategoryInput {
  name: string;
  slug?: string; // omitted or "" => generated from name
  sortOrder?: number; // default 0
}

/** Body of PATCH /api/admin/products/{id}/images/{imageId}. */
export interface ImageUpdate {
  alt?: string;
  sortOrder?: number;
}

export interface ListResponse<T> {
  items: T[];
}

export interface AdminUser {
  id: number;
  email: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SessionResponse {
  user: AdminUser;
}

export interface HealthResponse {
  status: 'ok';
}

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_JSON'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'CSRF_REJECTED'
  | 'NOT_FOUND'
  | 'SLUG_TAKEN'
  | 'IMAGE_LIMIT_REACHED'
  | 'FILE_TOO_LARGE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'READ_ONLY'
  | 'INTERNAL';

export interface FieldError {
  field: string; // dotted path into the request body, e.g. "colours.1.hex"
  message: string;
}

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string; // human readable, safe to show to the admin
    details?: FieldError[]; // present only for VALIDATION_FAILED
  };
}

/** Header every non-GET/HEAD/OPTIONS request to /api must carry. */
export const CSRF_HEADER = 'X-Saltline-CSRF';
export const CSRF_HEADER_VALUE = '1';

export const SESSION_COOKIE = 'saltline_session';
export const MAX_IMAGES_PER_PRODUCT = 8;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

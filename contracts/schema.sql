-- Contract version 5. Database schema (SQLite via node:sqlite).
-- READ ONLY for subagents. Migration 1 created this schema with amazon_url NOT NULL;
-- migration 2 (contract v5) rebuilds products so amazon_url is nullable, as shown here.
-- The database layer must reach exactly this schema after all migrations. PRAGMA foreign_keys = ON and journal_mode = WAL are set
-- on every connection opened by openDatabase().

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE categories (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 80),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 80),
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description   TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  price_cents   INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 1000000),
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  colours_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(colours_json) AND json_type(colours_json) = 'array'),
  sizes_json    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sizes_json) AND json_type(sizes_json) = 'array'),
  amazon_url    TEXT CHECK (amazon_url IS NULL OR amazon_url LIKE 'https://%'),
  featured      INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Public listing filters on status and category, ordered by featured then recency.
CREATE INDEX idx_products_status_category ON products (status, category_id);
CREATE INDEX idx_products_status_featured ON products (status, featured, created_at);

CREATE TABLE product_images (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL UNIQUE CHECK (filename NOT LIKE '%/%' AND filename NOT LIKE '%\%' AND filename NOT LIKE '%..%'),
  alt         TEXT NOT NULL DEFAULT '' CHECK (length(alt) <= 200),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_product_images_product ON product_images (product_id, sort_order, id);

CREATE TABLE admins (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- token_hash is the hex SHA-256 of the raw cookie token. The raw token is never stored.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  admin_id    INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_sessions_expires ON sessions (expires_at);

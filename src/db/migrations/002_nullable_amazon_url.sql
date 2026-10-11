-- Contract version 5. Rebuilds products so amazon_url is nullable (DB-008).
-- Run by migrate.ts with foreign_keys OFF and legacy_alter_table ON, so renaming
-- the old table leaves product_images pointing at "products" and dropping it
-- cascades nothing. The new table and indexes match contracts/schema.sql exactly.

ALTER TABLE products RENAME TO products_v1;

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

INSERT INTO products (id, slug, name, description, price_cents, category_id, colours_json, sizes_json,
                      amazon_url, featured, status, created_at, updated_at)
SELECT id, slug, name, description, price_cents, category_id, colours_json, sizes_json,
       amazon_url, featured, status, created_at, updated_at
FROM products_v1;

DROP TABLE products_v1;

CREATE INDEX idx_products_status_category ON products (status, category_id);
CREATE INDEX idx_products_status_featured ON products (status, featured, created_at);

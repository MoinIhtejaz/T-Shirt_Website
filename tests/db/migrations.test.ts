import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepositories, openDatabase } from '../../src/db/index';
import { loadMigrations, runMigrations } from '../../src/db/migrate';

const CONTRACT_SQL = fs.readFileSync(path.resolve('contracts/schema.sql'), 'utf8');

function schemaObjects(db: DatabaseSync): { type: string; name: string; sql: string }[] {
  return db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all() as unknown as { type: string; name: string; sql: string }[];
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saltline-db-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase (DB-001)', () => {
  it("yields every table and index declared in schema.sql for ':memory:'", () => {
    const db = openDatabase(':memory:');
    const names = schemaObjects(db).map((o) => `${o.type}:${o.name}`);

    const declared = [...CONTRACT_SQL.matchAll(/CREATE\s+(TABLE|INDEX)\s+(\w+)/gi)].map(
      (m) => `${m[1].toLowerCase()}:${m[2]}`,
    );
    expect(declared.length).toBeGreaterThanOrEqual(10);
    expect(names.sort()).toEqual(declared.sort());
  });

  it('creates exactly the DDL in contracts/schema.sql', () => {
    const reference = new DatabaseSync(':memory:');
    reference.exec(CONTRACT_SQL);
    const db = openDatabase(':memory:');
    expect(schemaObjects(db)).toEqual(schemaObjects(reference));
  });

  it('records migrations 1 and 2 in schema_migrations', () => {
    const db = openDatabase(':memory:');
    const rows = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all() as unknown as {
      version: number;
      applied_at: string;
    }[];
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    for (const row of rows) expect(Number.isNaN(Date.parse(row.applied_at))).toBe(false);
  });

  it('enables foreign keys', () => {
    const db = openDatabase(':memory:');
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual(expect.objectContaining({ foreign_keys: 1 }));
  });

  it('applies each migration only once when the same file is opened twice, and keeps data', () => {
    const file = path.join(tempDir(), 'nested', 'dir', 'test.db'); // parent dirs created on demand
    const first = openDatabase(file);
    createRepositories(first).categories.create({ slug: 'graphic', name: 'Graphic', sortOrder: 0 });
    first.close();

    const second = openDatabase(file);
    const count = second.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as unknown as { n: number };
    expect(count.n).toBe(2);
    expect(createRepositories(second).categories.list()).toHaveLength(1);
    expect(second.prepare('PRAGMA foreign_keys').get()).toEqual(expect.objectContaining({ foreign_keys: 1 }));
    expect(second.prepare('PRAGMA journal_mode').get()).toEqual(expect.objectContaining({ journal_mode: 'wal' }));
    second.close();
  });

  it('applies later migrations forward-only and rolls back a failing one', () => {
    const db = openDatabase(':memory:');
    const extra = [{ version: 3, sql: 'CREATE TABLE extra (id INTEGER PRIMARY KEY);' }];
    expect(runMigrations(db, extra)).toEqual([3]);
    expect(runMigrations(db, extra)).toEqual([]);

    const broken = [{ version: 4, sql: 'CREATE TABLE half (id INTEGER); THIS IS NOT SQL;' }];
    expect(() => runMigrations(db, broken)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as unknown as {
      version: number;
    }[];
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });
});

describe('migration 2: nullable amazon_url (DB-008)', () => {
  it('upgrades a version 1 database in place, keeping products and their images', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    const [v1, v2] = loadMigrations();
    expect(runMigrations(db, [v1])).toEqual([1]);
    db.exec(`INSERT INTO categories (id, slug, name) VALUES (1, 'graphic', 'Graphic');
      INSERT INTO products (id, slug, name, price_cents, category_id, amazon_url, status)
        VALUES (7, 'old-tee', 'Old Tee', 3995, 1, 'https://www.amazon.com.au/dp/B0OLD', 'published');
      INSERT INTO product_images (product_id, filename, alt) VALUES (7, 'a.jpg', 'front');`);

    expect(runMigrations(db, [v1, v2])).toEqual([2]);

    expect(db.prepare('SELECT id, slug, amazon_url, category_id FROM products').all()).toEqual([
      expect.objectContaining({ id: 7, slug: 'old-tee', amazon_url: 'https://www.amazon.com.au/dp/B0OLD', category_id: 1 }),
    ]);
    expect(db.prepare('SELECT product_id, filename FROM product_images').all()).toEqual([
      expect.objectContaining({ product_id: 7, filename: 'a.jpg' }),
    ]);
    db.prepare("UPDATE products SET amazon_url = NULL WHERE id = 7").run();
    expect(() => db.prepare("UPDATE products SET amazon_url = 'http://x' WHERE id = 7").run()).toThrow();
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual(expect.objectContaining({ foreign_keys: 1 }));
    expect(db.prepare('PRAGMA legacy_alter_table').get()).toEqual(expect.objectContaining({ legacy_alter_table: 0 }));
    db.prepare('DELETE FROM products WHERE id = 7').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_images').get()).toEqual(expect.objectContaining({ n: 0 }));
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepositories, openDatabase } from '../../src/db/index';
import { runMigrations } from '../../src/db/migrate';

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

  it('records migration 1 in schema_migrations', () => {
    const db = openDatabase(':memory:');
    const rows = db.prepare('SELECT version, applied_at FROM schema_migrations').all() as unknown as {
      version: number;
      applied_at: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(Number.isNaN(Date.parse(rows[0].applied_at))).toBe(false);
  });

  it('enables foreign keys', () => {
    const db = openDatabase(':memory:');
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual(expect.objectContaining({ foreign_keys: 1 }));
  });

  it('applies migration 1 only once when the same file is opened twice, and keeps data', () => {
    const file = path.join(tempDir(), 'nested', 'dir', 'test.db'); // parent dirs created on demand
    const first = openDatabase(file);
    createRepositories(first).categories.create({ slug: 'graphic', name: 'Graphic', sortOrder: 0 });
    first.close();

    const second = openDatabase(file);
    const count = second.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as unknown as { n: number };
    expect(count.n).toBe(1);
    expect(createRepositories(second).categories.list()).toHaveLength(1);
    expect(second.prepare('PRAGMA foreign_keys').get()).toEqual(expect.objectContaining({ foreign_keys: 1 }));
    expect(second.prepare('PRAGMA journal_mode').get()).toEqual(expect.objectContaining({ journal_mode: 'wal' }));
    second.close();
  });

  it('applies later migrations forward-only and rolls back a failing one', () => {
    const db = openDatabase(':memory:');
    const extra = [{ version: 2, sql: 'CREATE TABLE extra (id INTEGER PRIMARY KEY);' }];
    expect(runMigrations(db, extra)).toEqual([2]);
    expect(runMigrations(db, extra)).toEqual([]);

    const broken = [{ version: 3, sql: 'CREATE TABLE half (id INTEGER); THIS IS NOT SQL;' }];
    expect(() => runMigrations(db, broken)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as unknown as {
      version: number;
    }[];
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });
});

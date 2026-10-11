// Forward-only migration runner. Applied versions are tracked in
// schema_migrations, which migration 1 itself creates (see schema.sql).
import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  sql: string;
  /** Rebuilds a table: runs with foreign_keys OFF and legacy_alter_table ON, then checks foreign keys before commit. */
  rebuildsTables?: boolean;
}

function readMigration(file: string): string {
  return fs.readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8');
}

/** Every migration, in ascending version order. Never edit an applied one; add a new file instead. */
export function loadMigrations(): Migration[] {
  return [
    { version: 1, sql: readMigration('001_init.sql') },
    { version: 2, sql: readMigration('002_nullable_amazon_url.sql'), rebuildsTables: true },
  ];
}

function currentVersion(db: DatabaseSync): number {
  const table = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!table) return 0;
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}

/** Applies every pending migration, each inside its own IMMEDIATE transaction. Returns the versions applied. */
export function runMigrations(db: DatabaseSync, migrations: Migration[] = loadMigrations()): number[] {
  const applied: number[] = [];
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= currentVersion(db)) continue;
    // Both pragmas are no-ops inside a transaction, so they are set before BEGIN.
    const fkWasOn = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys === 1;
    if (migration.rebuildsTables) {
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('PRAGMA legacy_alter_table = ON');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      // Re-check under the write lock in case another process migrated first.
      if (migration.version > currentVersion(db)) {
        db.exec(migration.sql);
        if (migration.rebuildsTables && db.prepare('PRAGMA foreign_key_check').get()) {
          throw new Error(`Migration ${migration.version} left foreign key violations`);
        }
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
          migration.version,
          new Date().toISOString(),
        );
        applied.push(migration.version);
      }
      db.exec('COMMIT');
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw err;
    } finally {
      if (migration.rebuildsTables) {
        db.exec('PRAGMA legacy_alter_table = OFF');
        if (fkWasOn) db.exec('PRAGMA foreign_keys = ON');
      }
    }
  }
  return applied;
}

// Forward-only migration runner. Applied versions are tracked in
// schema_migrations, which migration 1 itself creates (see schema.sql).
import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  sql: string;
}

function readMigration(file: string): string {
  return fs.readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8');
}

/** Every migration, in ascending version order. Never edit an applied one; add a new file instead. */
export function loadMigrations(): Migration[] {
  return [{ version: 1, sql: readMigration('001_init.sql') }];
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
    db.exec('BEGIN IMMEDIATE');
    try {
      // Re-check under the write lock in case another process migrated first.
      if (migration.version > currentVersion(db)) {
        db.exec(migration.sql);
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
    }
  }
  return applied;
}

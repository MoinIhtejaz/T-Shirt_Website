// DATABASE layer entry point. Exports exactly DbModule from contracts/modules.ts.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DbModule } from '../../contracts/modules';
import { runMigrations } from './migrate';
import { buildRepositories } from './repositories';

export const openDatabase: DbModule['openDatabase'] = (file) => {
  const inMemory = file === ':memory:';
  if (!inMemory) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    if (!inMemory) db.exec('PRAGMA journal_mode = WAL');
    runMigrations(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
};

export const createRepositories: DbModule['createRepositories'] = (db) => buildRepositories(db);

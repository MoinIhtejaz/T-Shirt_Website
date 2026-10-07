// SEC-004 full-stack harness. Builds the real app from src/app.ts with an
// in-memory database and a throwaway upload directory, and seeds one admin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../src/app';
import { testConfig, type AppConfig } from '../../src/shared/config';
import { createRepositories } from '../../src/db/index';
import { hashPassword } from '../../src/auth/index';
import type { Repositories } from '../../contracts/modules';
import type { ProductInput } from '../../contracts/types';

export const CSRF = { 'X-Saltline-CSRF': '1' } as const;
export const ADMIN_EMAIL = 'sec-review@saltline.test';
export const ADMIN_PASSWORD = 'rip-current-at-tamarama-9';

/** Smallest valid 1x1 PNG. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let cachedHash: string | null = null;

export interface SecApp {
  app: Express;
  db: DatabaseSync;
  repos: Repositories;
  uploadDir: string;
  config: AppConfig;
  /** A supertest agent that has logged in; cookies persist between calls. */
  login(): Promise<ReturnType<typeof request.agent>>;
  cleanup(): void;
}

export async function makeSecApp(overrides: Partial<AppConfig> = {}): Promise<SecApp> {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saltline-sec-'));
  const config = testConfig({ uploadDir, ...overrides });
  const { app, db } = createApp(config);
  const repos = createRepositories(db);
  cachedHash ??= await hashPassword(ADMIN_PASSWORD);
  repos.admins.upsert(ADMIN_EMAIL, cachedHash);

  return {
    app,
    db,
    repos,
    uploadDir,
    config,
    async login() {
      const agent = request.agent(app);
      const res = await agent.post('/api/auth/login').set(CSRF).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
      return agent;
    },
    cleanup() {
      db.close();
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

export function productInput(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: 'Review Tee',
    description: 'Plain text only.',
    priceCents: 4500,
    categoryId: null,
    colours: [{ name: 'Harbour Blue', hex: '#1A4E8A' }],
    sizes: ['S', 'M'],
    amazonUrl: 'https://www.amazon.com.au/dp/B000SECREV',
    featured: false,
    status: 'published',
    ...overrides,
  };
}

/** Parses a Set-Cookie line into lower-cased attribute names and values. */
export function cookieAttributes(setCookie: string): Map<string, string> {
  const parts = setCookie.split(';').map((s) => s.trim());
  const attrs = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const [k, ...v] = part.split('=');
    attrs.set(k.toLowerCase(), v.join('='));
  }
  return attrs;
}

export const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DIST_INDEX = path.join(PROJECT_ROOT, 'dist/ui/index.html');
export const hasBuiltUi = fs.existsSync(DIST_INDEX);

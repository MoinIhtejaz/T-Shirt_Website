// Full-stack harness for the API tests: the real app (src/app.ts), an in-memory
// database, a temp upload dir and one logged-in supertest agent per app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../src/app';
import { testConfig } from '../../src/shared/config';
import { createRepositories } from '../../src/db/index';
import { hashPassword } from '../../src/auth/index';
import type { Repositories } from '../../contracts/modules';
import type { ProductInput } from '../../contracts/types';

export const CSRF = { 'X-Saltline-CSRF': '1' } as const;
const ADMIN_EMAIL = 'owner@saltline.test';
const ADMIN_PASSWORD = 'tide-pool-harbour-42';

export interface TestApp {
  app: Express;
  db: DatabaseSync;
  repos: Repositories;
  uploadDir: string;
  /** Logged in, cookie kept between requests. Add CSRF yourself on writes. */
  admin: ReturnType<typeof request.agent>;
  cleanup(): void;
}

let cachedHash: string | null = null;

export async function makeTestApp(): Promise<TestApp> {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saltline-api-'));
  const { app, db } = createApp(testConfig({ uploadDir }));
  const repos = createRepositories(db);
  cachedHash ??= await hashPassword(ADMIN_PASSWORD);
  repos.admins.upsert(ADMIN_EMAIL, cachedHash);

  const admin = request.agent(app);
  const login = await admin.post('/api/auth/login').set(CSRF).send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);

  return {
    app,
    db,
    repos,
    uploadDir,
    admin,
    cleanup() {
      db.close();
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

export function productInput(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: 'Bondi Swell Tee',
    description: 'Heavyweight cotton.\nPrinted in Marrickville.',
    priceCents: 4500,
    categoryId: null,
    colours: [{ name: 'Harbour Blue', hex: '#1a4e8a' }],
    sizes: ['M', 'S'],
    amazonUrl: 'https://www.amazon.com.au/dp/B000TEST01',
    featured: false,
    status: 'published',
    ...overrides,
  };
}

/** Smallest valid 1x1 transparent PNG. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
/** JPEG SOI + APP0 marker start; enough for magic-byte detection. */
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
/** RIFF....WEBPVP8 header. */
export const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1'),
  Buffer.alloc(14),
]);
export const HTML_BYTES = Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8');

export function uploadedFiles(dir: string): string[] {
  return fs.readdirSync(dir).sort();
}

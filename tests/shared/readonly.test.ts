import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig, loadVercelConfig, testConfig } from '../../src/shared/config';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ro-'));

describe('read-only mode', () => {
  const { app } = createApp(testConfig({ uploadDir: tmp(), readOnly: true }));

  it('still serves reads', async () => {
    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/products').expect(200);
  });

  it('refuses every write, login included, before the CSRF check', async () => {
    for (const [method, url] of [
      ['post', '/api/auth/login'],
      ['post', '/api/admin/products'],
      ['put', '/api/admin/products/1'],
      ['patch', '/api/admin/products/1/images/1'],
      ['delete', '/api/admin/categories/1'],
    ] as const) {
      const res = await request(app)[method](url).send({});
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.body.error.code).toBe('READ_ONLY');
    }
  });
});

describe('config', () => {
  it('READ_ONLY defaults to off', () => {
    expect(loadConfig({}).readOnly).toBe(false);
    expect(loadConfig({ READ_ONLY: 'true' }).readOnly).toBe(true);
  });

  it('Vercel runs read-only from the temp dir over HTTPS', () => {
    const c = loadVercelConfig({});
    expect(c.readOnly).toBe(true);
    expect(c.cookieSecure).toBe(true);
    expect(c.databaseFile.startsWith(os.tmpdir())).toBe(true);
    expect(c.uploadDir.startsWith(os.tmpdir())).toBe(true);
    expect(loadVercelConfig({ READ_ONLY: 'false' }).readOnly).toBe(true);
  });
});

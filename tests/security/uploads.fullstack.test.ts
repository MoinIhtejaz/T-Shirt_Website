// SEC-004: hostile uploads and the /uploads route on the assembled app.
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../src/db/seed';
import { hashPassword } from '../../src/auth/index';
import { CSRF, PNG_BYTES, makeSecApp, productInput, type SecApp } from './fullstack';

const UPLOADS_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const SVG_BYTES = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"><script>alert(1)</script></svg>',
);
const SVG_NO_PROLOG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML_BYTES = Buffer.from('<!doctype html><html><body><script>alert(document.cookie)</script></body></html>');
const XHTML_BYTES = Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>');
const GIF_BYTES = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
const PDF_BYTES = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
/** "Looks like" PNG to a lazy check that only reads the first 4 bytes. */
const FAKE_PNG_PREFIX = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), HTML_BYTES]);
/** Real PNG signature followed by HTML. Accepted by design, but it must be served inertly. */
const PNG_POLYGLOT = Buffer.concat([PNG_BYTES, HTML_BYTES]);

describe('SEC-004 hostile uploads', () => {
  let t: SecApp;
  let admin: Awaited<ReturnType<SecApp['login']>>;
  let productId: number;

  beforeAll(async () => {
    t = await makeSecApp();
    admin = await t.login();
    productId = (await admin.post('/api/admin/products').set(CSRF).send(productInput())).body.id;
  });
  afterAll(() => t.cleanup());

  const files = () => fs.readdirSync(t.uploadDir).sort();
  const upload = (bytes: Buffer, filename: string, contentType: string) =>
    admin.post(`/api/admin/products/${productId}/images`).set(CSRF).attach('image', bytes, { filename, contentType });

  const disguised: Array<[string, Buffer, string, string]> = [
    ['SVG named .png with image/png', SVG_BYTES, 'photo.png', 'image/png'],
    ['SVG without XML prolog named .png', SVG_NO_PROLOG, 'photo.png', 'image/png'],
    ['SVG declared as image/svg+xml', SVG_BYTES, 'logo.svg', 'image/svg+xml'],
    ['HTML named .png with image/png', HTML_BYTES, 'photo.png', 'image/png'],
    ['HTML named .jpg with image/jpeg', HTML_BYTES, 'photo.jpg', 'image/jpeg'],
    ['XHTML named .webp', XHTML_BYTES, 'photo.webp', 'image/webp'],
    ['HTML behind a 4-byte PNG prefix', FAKE_PNG_PREFIX, 'photo.png', 'image/png'],
    ['GIF (not on the allow-list)', GIF_BYTES, 'anim.gif', 'image/gif'],
    ['PDF named .png', PDF_BYTES, 'doc.png', 'image/png'],
    ['empty file', Buffer.alloc(0), 'empty.png', 'image/png'],
  ];

  for (const [label, bytes, filename, type] of disguised) {
    it(`${label} gets 415 and nothing is written`, async () => {
      const before = files();
      const res = await upload(bytes, filename, type);
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(files()).toEqual(before);
      expect(t.repos.images.countForProduct(productId)).toBe(0);
    });
  }

  it('the client filename never reaches the disk (traversal names are ignored)', async () => {
    for (const filename of ['../../escape.png', '..\\..\\escape.png', '/etc/passwd.png', '.htaccess.png']) {
      const res = await upload(PNG_BYTES, filename, 'image/png');
      expect(res.status, filename).toBe(201);
      expect(res.body.url).toMatch(/^\/uploads\/[0-9a-f]{32}\.png$/);
    }
    expect(fs.existsSync(path.join(t.uploadDir, '..', 'escape.png'))).toBe(false);
    for (const f of files()) expect(f).toMatch(/^[0-9a-f]{32}\.png$/);
    // Clean up so later tests start from an empty product.
    for (const img of t.repos.images.listForProduct(productId)) {
      await admin.delete(`/api/admin/products/${productId}/images/${img.id}`).set(CSRF).expect(204);
    }
  });

  it('a PNG/HTML polyglot is stored as .png and served as an inert, sandboxed image', async () => {
    const res = await upload(PNG_POLYGLOT, 'page.html', 'text/html');
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/uploads\/[0-9a-f]{32}\.png$/);

    const served = await request(t.app).get(res.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toBe(UPLOADS_CSP);
    expect(served.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(served.headers['x-frame-options']).toBe('DENY');
  });
});

describe('SEC-004 /uploads route', () => {
  let t: SecApp;
  let seededUrls: string[];

  beforeAll(async () => {
    t = await makeSecApp();
    const result = await seedDatabase(t.db, t.uploadDir, { email: 'seed@saltline.test', password: 'seed-password-long' }, hashPassword);
    seededUrls = result.imagesWritten.map((p) => `/uploads/${path.basename(p)}`);
    fs.writeFileSync(path.join(t.uploadDir, '.secret'), 'dotfile');
    fs.mkdirSync(path.join(t.uploadDir, 'sub'));
  });
  afterAll(() => t.cleanup());

  it('seeded catalogue photos are served as JPEG with the sandbox CSP, nosniff, CORP and frame denial', async () => {
    expect(seededUrls.length).toBeGreaterThan(0);
    for (const url of seededUrls) {
      const res = await request(t.app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.headers['content-type'], url).toBe('image/jpeg');
      expect(res.headers['content-security-policy'], url).toBe(UPLOADS_CSP);
      expect(res.headers['x-content-type-options'], url).toBe('nosniff');
      expect(res.headers['cross-origin-resource-policy'], url).toBe('same-origin');
      expect(res.headers['x-frame-options'], url).toBe('DENY');
    }
  });

  it('every seeded file is a real JPEG by magic bytes, stored under a server-generated name', () => {
    for (const url of seededUrls) {
      const name = path.basename(url);
      expect(name, url).toMatch(/^[0-9a-f]{32}\.jpg$/);
      const head = fs.readFileSync(path.join(t.uploadDir, name)).subarray(0, 3);
      expect([...head], url).toEqual([0xff, 0xd8, 0xff]);
    }
  });

  it('traversal, dotfiles and directory listings are 404 with the sandbox CSP', async () => {
    const probes = [
      '/uploads/../package.json',
      '/uploads/%2e%2e/package.json',
      '/uploads/..%2fpackage.json',
      '/uploads/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/uploads/..%5cpackage.json',
      '/uploads/.secret',
      '/uploads/%2esecret',
      '/uploads/',
      '/uploads/sub/',
      '/uploads/missing.png',
    ];
    for (const url of probes) {
      const res = await request(t.app).get(url);
      expect([403, 404], `${url} -> ${res.status}`).toContain(res.status);
      expect(res.text ?? '').not.toContain('"name": "saltline-sydney"');
      expect(res.text ?? '').not.toContain('dotfile');
      if (url.startsWith('/uploads/') && !url.includes('..')) {
        expect(res.headers['content-security-policy'], url).toBe(UPLOADS_CSP);
      }
    }
  });

  it('a directory without a trailing slash only redirects to itself (no listing, no open redirect)', async () => {
    for (const url of ['/uploads/sub', '/uploads//sub']) {
      const res = await request(t.app).get(url);
      expect([301, 404], url).toContain(res.status);
      if (res.status === 301) {
        // Same-origin path only: never protocol-relative ("//host") or absolute.
        expect(res.headers.location, url).toMatch(/^\/uploads\/\/?sub\/$/);
        expect(res.headers.location.startsWith('//'), url).toBe(false);
      }
      // serve-static's redirect page sets its own, equally strict, default-src 'none'.
      expect(res.headers['content-security-policy'], url).toMatch(/^default-src 'none'/);
      expect(res.headers['x-content-type-options'], url).toBe('nosniff');
    }
    const followed = await request(t.app).get('/uploads/sub/');
    expect(followed.status).toBe(404);
  });

  it('every seeded product link passes the Amazon allow-list end to end', async () => {
    const { isAllowedAmazonUrl } = await import('../../src/security/index');
    const res = await request(t.app).get('/api/products');
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items as Array<{ slug: string }>) {
      const p = await request(t.app).get(`/api/products/${item.slug}`);
      expect(isAllowedAmazonUrl(p.body.amazonUrl), p.body.amazonUrl).toBe(true);
    }
  });

  it('writes to /uploads are not possible', async () => {
    for (const method of ['post', 'put', 'delete'] as const) {
      const res = await request(t.app)[method](seededUrls[0]).set(CSRF).send('x');
      expect(res.status, method).toBe(404);
    }
    expect(fs.existsSync(path.join(t.uploadDir, path.basename(seededUrls[0])))).toBe(true);
  });
});

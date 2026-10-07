// BE-003: image upload, patch and delete.
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '../../contracts/types';
import {
  CSRF,
  HTML_BYTES,
  JPEG_BYTES,
  PNG_BYTES,
  WEBP_BYTES,
  makeTestApp,
  productInput,
  uploadedFiles,
  type TestApp,
} from './helpers';

describe('admin images', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(() => t.cleanup());

  async function newProduct(name: string): Promise<number> {
    const res = await t.admin.post('/api/admin/products').set(CSRF).send(productInput({ name }));
    return res.body.id;
  }
  const upload = (id: number | string, bytes: Buffer, filename: string, contentType?: string) =>
    t.admin
      .post(`/api/admin/products/${id}/images`)
      .set(CSRF)
      .attach('image', bytes, contentType ? { filename, contentType } : filename);

  it('a PNG named evil.html is accepted and stored as .png', async () => {
    const id = await newProduct('Evil Name Tee');
    const res = await upload(id, PNG_BYTES, 'evil.html', 'text/html');
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['alt', 'id', 'sortOrder', 'url']);
    expect(res.body.url).toMatch(/^\/uploads\/[0-9a-f]{32}\.png$/);
    expect(res.body.alt).toBe('Evil Name Tee');
    expect(res.body.sortOrder).toBe(0);
    const file = path.join(t.uploadDir, path.basename(res.body.url));
    expect(fs.readFileSync(file).equals(PNG_BYTES)).toBe(true);
    expect(uploadedFiles(t.uploadDir).some((f) => f.includes('evil'))).toBe(false);

    const served = await request(t.app).get(res.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
  });

  it('detects JPEG and WebP by content and stores the alt text', async () => {
    const id = await newProduct('Formats Tee');
    const jpg = await upload(id, JPEG_BYTES, 'x.bin', 'application/octet-stream');
    expect(jpg.status).toBe(201);
    expect(jpg.body.url).toMatch(/\.jpg$/);
    const webp = await t.admin
      .post(`/api/admin/products/${id}/images`)
      .set(CSRF)
      .field('alt', '  Back print  ')
      .attach('image', WEBP_BYTES, 'x.png');
    expect(webp.status).toBe(201);
    expect(webp.body.url).toMatch(/\.webp$/);
    expect(webp.body.alt).toBe('Back print');
    expect(webp.body.sortOrder).toBe(1);
  });

  it('HTML bytes named photo.jpg get 415 and nothing is written', async () => {
    const id = await newProduct('Html Tee');
    const before = uploadedFiles(t.uploadDir);
    const res = await upload(id, HTML_BYTES, 'photo.jpg', 'image/jpeg');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(uploadedFiles(t.uploadDir)).toEqual(before);
    expect(t.repos.images.countForProduct(id)).toBe(0);
  });

  it('a missing image field is 415', async () => {
    const id = await newProduct('No File Tee');
    const res = await t.admin.post(`/api/admin/products/${id}/images`).set(CSRF).field('alt', 'hello');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const json = await t.admin.post(`/api/admin/products/${id}/images`).set(CSRF).send({ alt: 'x' });
    expect(json.status).toBe(415);
  });

  it('a file in the wrong field is 400, unknown text fields are 400, alt over 200 is 400', async () => {
    const id = await newProduct('Wrong Field Tee');
    const wrong = await t.admin.post(`/api/admin/products/${id}/images`).set(CSRF).attach('photo', PNG_BYTES, 'a.png');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('VALIDATION_FAILED');
    const extra = await t.admin
      .post(`/api/admin/products/${id}/images`)
      .set(CSRF)
      .field('sortOrder', '3')
      .attach('image', PNG_BYTES, 'a.png');
    expect(extra.status).toBe(400);
    expect(extra.body.error.details).toEqual([{ field: 'sortOrder', message: 'Unknown field.' }]);
    const longAlt = await t.admin
      .post(`/api/admin/products/${id}/images`)
      .set(CSRF)
      .field('alt', 'a'.repeat(201))
      .attach('image', PNG_BYTES, 'a.png');
    expect(longAlt.status).toBe(400);
    expect(longAlt.body.error.details[0].field).toBe('alt');
    expect(t.repos.images.countForProduct(id)).toBe(0);
  });

  it('over 5 MB gives 413 FILE_TOO_LARGE and nothing is written', async () => {
    const id = await newProduct('Big Tee');
    const before = uploadedFiles(t.uploadDir);
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_IMAGE_BYTES + 1 - PNG_BYTES.length)]);
    const res = await upload(id, big, 'big.png');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(uploadedFiles(t.uploadDir)).toEqual(before);
  });

  it('exactly 5 MB is accepted', async () => {
    const id = await newProduct('Max Tee');
    const max = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_IMAGE_BYTES - PNG_BYTES.length)]);
    const res = await upload(id, max, 'max.png');
    expect(res.status).toBe(201);
  });

  it('the 9th image gives 409 IMAGE_LIMIT_REACHED', async () => {
    const id = await newProduct('Full Tee');
    for (let i = 0; i < 8; i++) {
      const ok = await upload(id, PNG_BYTES, `${i}.png`);
      expect(ok.status).toBe(201);
    }
    const before = uploadedFiles(t.uploadDir);
    const ninth = await upload(id, PNG_BYTES, '9.png');
    expect(ninth.status).toBe(409);
    expect(ninth.body.error.code).toBe('IMAGE_LIMIT_REACHED');
    expect(uploadedFiles(t.uploadDir)).toEqual(before);
    expect(t.repos.images.countForProduct(id)).toBe(8);
  });

  it('uploading to a missing product is 404, a bad id is 400', async () => {
    expect((await upload(99999, PNG_BYTES, 'a.png')).status).toBe(404);
    expect((await upload('nope', PNG_BYTES, 'a.png')).status).toBe(400);
  });

  describe('PATCH', () => {
    it('updates alt and sortOrder (200 ProductImage)', async () => {
      const id = await newProduct('Patch Tee');
      const img = (await upload(id, PNG_BYTES, 'a.png')).body;
      const res = await t.admin
        .patch(`/api/admin/products/${id}/images/${img.id}`)
        .set(CSRF)
        .send({ alt: ' Front view ', sortOrder: 5 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: img.id, url: img.url, alt: 'Front view', sortOrder: 5 });
      const only = await t.admin.patch(`/api/admin/products/${id}/images/${img.id}`).set(CSRF).send({ sortOrder: 2 });
      expect(only.body).toMatchObject({ alt: 'Front view', sortOrder: 2 });
    });

    it('validates the body: empty, unknown keys, ranges', async () => {
      const id = await newProduct('Patch Validate Tee');
      const img = (await upload(id, PNG_BYTES, 'a.png')).body;
      const url = `/api/admin/products/${id}/images/${img.id}`;
      const empty = await t.admin.patch(url).set(CSRF).send({});
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe('VALIDATION_FAILED');
      const unknown = await t.admin.patch(url).set(CSRF).send({ filename: '../../etc/passwd' });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.details.map((d: { field: string }) => d.field)).toContain('filename');
      const range = await t.admin.patch(url).set(CSRF).send({ sortOrder: 1001, alt: 'a'.repeat(201) });
      expect(range.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['alt', 'sortOrder']);
      const badId = await t.admin.patch(`/api/admin/products/${id}/images/0`).set(CSRF).send({ alt: 'x' });
      expect(badId.status).toBe(400);
    });

    it('a wrong product/image pairing is 404', async () => {
      const a = await newProduct('Pair A');
      const b = await newProduct('Pair B');
      const img = (await upload(a, PNG_BYTES, 'a.png')).body;
      const res = await t.admin.patch(`/api/admin/products/${b}/images/${img.id}`).set(CSRF).send({ alt: 'x' });
      expect(res.status).toBe(404);
      const del = await t.admin.delete(`/api/admin/products/${b}/images/${img.id}`).set(CSRF);
      expect(del.status).toBe(404);
      expect(t.repos.images.get(a, img.id)).not.toBeNull();
    });
  });

  describe('DELETE', () => {
    it('removes the row and the file (204)', async () => {
      const id = await newProduct('Delete Img Tee');
      const img = (await upload(id, PNG_BYTES, 'a.png')).body;
      const file = path.join(t.uploadDir, path.basename(img.url));
      expect(fs.existsSync(file)).toBe(true);
      const res = await t.admin.delete(`/api/admin/products/${id}/images/${img.id}`).set(CSRF);
      expect(res.status).toBe(204);
      expect(fs.existsSync(file)).toBe(false);
      expect(t.repos.images.get(id, img.id)).toBeNull();
      const again = await t.admin.delete(`/api/admin/products/${id}/images/${img.id}`).set(CSRF);
      expect(again.status).toBe(404);
    });

    it('an already-missing file is not an error', async () => {
      const id = await newProduct('Missing File Tee');
      const img = (await upload(id, PNG_BYTES, 'a.png')).body;
      fs.unlinkSync(path.join(t.uploadDir, path.basename(img.url)));
      const res = await t.admin.delete(`/api/admin/products/${id}/images/${img.id}`).set(CSRF);
      expect(res.status).toBe(204);
      expect(t.repos.images.get(id, img.id)).toBeNull();
    });
  });
});

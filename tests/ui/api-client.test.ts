// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiRequest } from '../../src/ui/lib/api/client';
import { adminApi } from '../../src/ui/lib/api/endpoints';
import { dollarsInputToCents, formatPrice } from '../../src/ui/lib/api/format';
import { apiError, jsonResponse, mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('sends the CSRF header on %s', async (method) => {
    const { calls, fn } = mockFetch(() => jsonResponse({ ok: true }));
    await apiRequest(method, '/api/admin/products/1', { body: { a: 1 } });
    expect(calls[0].headers.get('X-Saltline-CSRF')).toBe('1');
    expect(calls[0].method).toBe(method);
    expect(fn.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' });
  });

  it('does not send the CSRF header on GET', async () => {
    const { calls, fn } = mockFetch(() => jsonResponse({ items: [] }));
    await apiRequest('GET', '/api/products');
    expect(calls[0].headers.has('X-Saltline-CSRF')).toBe(false);
    expect(fn.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' });
  });

  it('serialises JSON bodies with a JSON content type', async () => {
    const { calls } = mockFetch(() => jsonResponse({}));
    await apiRequest('POST', '/api/auth/login', { body: { email: 'a@b.co', password: 'x' } });
    expect(calls[0].headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(calls[0].body))).toEqual({ email: 'a@b.co', password: 'x' });
  });

  it('parses the error envelope into a typed ApiClientError', async () => {
    mockFetch(() =>
      apiError(400, 'VALIDATION_FAILED', 'Some fields need fixing.', [
        { field: 'colours.1.hex', message: 'Use a hex colour like #1F4E6B.' },
      ]),
    );
    const err = await apiRequest('POST', '/api/admin/products', { body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    const e = err as ApiClientError;
    expect(e.status).toBe(400);
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.message).toBe('Some fields need fixing.');
    expect(e.details).toEqual([{ field: 'colours.1.hex', message: 'Use a hex colour like #1F4E6B.' }]);
  });

  it('defaults details to an empty array and reads Retry-After', async () => {
    mockFetch(() =>
      jsonResponse({ error: { code: 'RATE_LIMITED', message: 'Too many attempts.' } }, 429, { 'Retry-After': '60' }),
    );
    const e = (await apiRequest('POST', '/api/auth/login', { body: {} }).catch((x: unknown) => x)) as ApiClientError;
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.details).toEqual([]);
    expect(e.retryAfter).toBe(60);
  });

  it('turns a network failure into NETWORK_ERROR with status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const e = (await apiRequest('GET', '/api/products').catch((x: unknown) => x)) as ApiClientError;
    expect(e).toBeInstanceOf(ApiClientError);
    expect(e.status).toBe(0);
    expect(e.code).toBe('NETWORK_ERROR');
    expect(e.message).toMatch(/could not reach the server/i);
  });

  it('handles a non-JSON error body (e.g. a proxy page)', async () => {
    mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    const e = (await apiRequest('GET', '/api/products').catch((x: unknown) => x)) as ApiClientError;
    expect(e.status).toBe(502);
    expect(e.code).toBe('BAD_RESPONSE');
    expect(e.message).not.toContain('<html>');
  });

  it('handles a 413 without a JSON body with a useful message', async () => {
    mockFetch(() => new Response('Request Entity Too Large', { status: 413 }));
    const e = (await apiRequest('POST', '/api/admin/products/1/images').catch((x: unknown) => x)) as ApiClientError;
    expect(e.status).toBe(413);
    expect(e.message).toMatch(/5 MB/);
  });

  it('rejects a 200 whose body is not JSON', async () => {
    mockFetch(() => new Response('not json', { status: 200 }));
    const e = (await apiRequest('GET', '/api/products').catch((x: unknown) => x)) as ApiClientError;
    expect(e.code).toBe('BAD_RESPONSE');
  });

  it('resolves undefined for 204', async () => {
    mockFetch(() => jsonResponse(null, 204));
    await expect(apiRequest('DELETE', '/api/admin/products/1')).resolves.toBeUndefined();
  });

  it('uploads images as multipart with the CSRF header and no manual content type', async () => {
    const { calls } = mockFetch(() => jsonResponse({ id: 3, url: '/uploads/x.png', alt: 'Alt', sortOrder: 2 }, 201));
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shirt.png', { type: 'image/png' });
    await adminApi.uploadImage(5, file, ' Alt ');
    const call = calls[0];
    expect(call.url).toBe('/api/admin/products/5/images');
    expect(call.method).toBe('POST');
    expect(call.headers.get('X-Saltline-CSRF')).toBe('1');
    expect(call.headers.has('Content-Type')).toBe(false);
    const form = call.body as FormData;
    expect(form.get('image')).toBeInstanceOf(File);
    expect(form.get('alt')).toBe('Alt');
  });
});

describe('price helpers', () => {
  it('formats cents as AUD', () => {
    expect(formatPrice(4995)).toBe('$49.95');
    expect(formatPrice(0)).toBe('$0.00');
  });

  it('converts typed dollars to integer cents', () => {
    expect(dollarsInputToCents('49')).toBe(4900);
    expect(dollarsInputToCents('49.9')).toBe(4990);
    expect(dollarsInputToCents('$1,049.95')).toBe(104995);
    expect(dollarsInputToCents('0.07')).toBe(7);
    expect(dollarsInputToCents('49.999')).toBeNull();
    expect(dollarsInputToCents('-5')).toBeNull();
    expect(dollarsInputToCents('abc')).toBeNull();
    expect(dollarsInputToCents('')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { securityHeaders, csrfGuard } from '../../src/security/index';
import { buildCsp } from '../../src/security/headers';
import { errorHandler } from '../../src/shared/http';
import { testConfig, type AppConfig } from '../../src/shared/config';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../../contracts/types';

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const UPLOADS_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

function headersApp(overrides: Partial<AppConfig> = {}) {
  const app = express();
  app.use(securityHeaders(testConfig(overrides)));
  app.get('/page', (_req, res) => {
    res.send('<p>hi</p>');
  });
  app.get('/boom', () => {
    throw new Error('kaboom');
  });
  // Mirrors the /uploads sandbox in src/app.ts, which runs after securityHeaders.
  app.use('/uploads', (_req, res) => {
    res.setHeader('Content-Security-Policy', UPLOADS_CSP);
    res.status(404).end();
  });
  app.use(errorHandler);
  return app;
}

function directives(csp: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name, values.join(' '));
  }
  return map;
}

describe('securityHeaders', () => {
  it('sets the exact development CSP', async () => {
    const res = await request(headersApp()).get('/page');
    expect(res.headers['content-security-policy']).toBe(EXPECTED_CSP);
  });

  it('CSP blocks inline script and framing', async () => {
    const res = await request(headersApp()).get('/page');
    const d = directives(res.headers['content-security-policy']);
    expect(d.get('script-src')).toBe("'self'");
    expect(d.get('script-src')).not.toContain('unsafe-inline');
    expect(d.get('script-src')).not.toContain('unsafe-eval');
    expect(d.get('default-src')).toBe("'self'");
    expect(d.get('frame-ancestors')).toBe("'none'");
    expect(d.get('object-src')).toBe("'none'");
    expect(d.get('base-uri')).toBe("'self'");
    expect(d.get('form-action')).toBe("'self'");
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets nosniff, Referrer-Policy and the other baseline headers', async () => {
    const res = await request(headersApp()).get('/page');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('applies to error and not-found responses too', async () => {
    const app = headersApp();
    const boom = await request(app).get('/boom');
    expect(boom.status).toBe(500);
    expect(boom.headers['content-security-policy']).toBe(EXPECTED_CSP);
    expect(boom.headers['x-content-type-options']).toBe('nosniff');
    const missing = await request(app).get('/nope');
    expect(missing.status).toBe(404);
    expect(missing.headers['x-frame-options']).toBe('DENY');
  });

  it('omits HSTS unless cookieSecure is true', async () => {
    const res = await request(headersApp({ cookieSecure: false })).get('/page');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('sets HSTS when cookieSecure is true', async () => {
    const res = await request(headersApp({ cookieSecure: true })).get('/page');
    expect(res.headers['strict-transport-security']).toBe('max-age=15552000; includeSubDomains');
  });

  it('appends upgrade-insecure-requests only when served over HTTPS (cookieSecure), whatever NODE_ENV is', async () => {
    const cases: Array<[boolean, boolean, string]> = [
      [true, true, `${EXPECTED_CSP}; upgrade-insecure-requests`],
      [false, true, `${EXPECTED_CSP}; upgrade-insecure-requests`],
      [true, false, EXPECTED_CSP],
      [false, false, EXPECTED_CSP],
    ];
    for (const [isProduction, cookieSecure, expected] of cases) {
      const res = await request(headersApp({ isProduction, cookieSecure })).get('/page');
      expect(res.headers['content-security-policy'], `isProduction=${isProduction} cookieSecure=${cookieSecure}`).toBe(
        expected,
      );
    }
  });

  it('buildCsp keys the directive on HTTPS (DEF-001)', () => {
    expect(buildCsp(true)).toBe(`${EXPECTED_CSP}; upgrade-insecure-requests`);
    expect(buildCsp(false)).toBe(EXPECTED_CSP);
  });

  it('lets a later handler replace the CSP (the /uploads sandbox)', async () => {
    const res = await request(headersApp()).get('/uploads/x.png');
    expect(res.headers['content-security-policy']).toBe(UPLOADS_CSP);
    // Only one CSP header, so the browser doesn't combine the two policies.
    expect(res.headers['content-security-policy']).not.toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

function csrfApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', csrfGuard());
  app.all('/api/thing', (req, res) => {
    res.status(200).json({ ok: true, method: req.method });
  });
  app.use(errorHandler);
  return app;
}

describe('csrfGuard', () => {
  it('lets GET, HEAD and OPTIONS through without the header', async () => {
    const app = csrfApp();
    expect((await request(app).get('/api/thing')).status).toBe(200);
    expect((await request(app).head('/api/thing')).status).toBe(200);
    expect((await request(app).options('/api/thing')).status).toBe(200);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)('%s without the header gives 403 CSRF_REJECTED', async (method) => {
    const res = await request(csrfApp())[method]('/api/thing').send({ a: 1 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'CSRF_REJECTED', message: expect.any(String) } });
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)('%s with X-Saltline-CSRF: 1 passes', async (method) => {
    const res = await request(csrfApp())[method]('/api/thing').set(CSRF_HEADER, CSRF_HEADER_VALUE).send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('matches the header name case-insensitively', async () => {
    const res = await request(csrfApp()).post('/api/thing').set('x-saltline-csrf', '1');
    expect(res.status).toBe(200);
  });

  it.each(['0', 'true', '1, 1', '11', 'l', ''])('rejects the wrong header value %j', async (value) => {
    const res = await request(csrfApp()).post('/api/thing').set(CSRF_HEADER, value);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('rejects a POST that looks like a cross-site form submission', async () => {
    const res = await request(csrfApp())
      .post('/api/thing')
      .set('Origin', 'https://evil.example')
      .type('form')
      .send('a=1');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('rejects unusual state-changing verbs as well', async () => {
    const app = csrfApp();
    const res = await request(app).search('/api/thing');
    expect(res.status).toBe(403);
  });
});

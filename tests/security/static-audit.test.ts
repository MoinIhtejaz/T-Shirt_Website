// SEC-004: static checks over source, config and the built bundle.
// These guard the round-1 follow-ups that are easiest to regress silently.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedAmazonUrl } from '../../src/security/index';
import { loadCatalogue } from '../../src/db/seed';
import { DIST_INDEX, PROJECT_ROOT, hasBuiltUi } from './fullstack';

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

const rel = (p: string) => path.relative(PROJECT_ROOT, p);
const SRC = path.join(PROJECT_ROOT, 'src');
const UI = path.join(SRC, 'ui');
const uiFiles = walk(UI, ['.ts', '.tsx']);
const serverFiles = walk(SRC, ['.ts']).filter((f) => !f.startsWith(UI + path.sep));

describe('SEC-004 frontend source', () => {
  it('has no raw-HTML sinks (dangerouslySetInnerHTML, innerHTML, outerHTML, insertAdjacentHTML, document.write, eval)', () => {
    const sink = /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(|srcdoc/;
    const hits = uiFiles.filter((f) => sink.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(hits).toEqual([]);
  });

  it('every target="_blank" link carries rel noopener and noreferrer', () => {
    for (const file of uiFiles) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/<a\b[^>]*?target="_blank"[^>]*?>/gs)) {
        const rel = /rel="([^"]*)"/.exec(m[0])?.[1] ?? '';
        expect(rel.split(/\s+/), `${file}: ${m[0]}`).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
      }
    }
  });

  it('the Buy on Amazon link is rel="noopener noreferrer sponsored"', () => {
    const page = fs.readFileSync(path.join(UI, 'pages/ProductPage.tsx'), 'utf8');
    const buy = /<a\b[^>]*href=\{product\.amazonUrl\}[^>]*>/s.exec(page)?.[0] ?? '';
    expect(buy).toContain('target="_blank"');
    expect(buy).toContain('rel="noopener noreferrer sponsored"');
  });

  it('imports nothing server-side and reads no env secrets', () => {
    for (const file of uiFiles) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text, rel(file)).not.toMatch(/from ['"](?:node:|\.\.\/(?:\.\.\/)*(?:auth|db|api|services|security|shared)\/)/);
      expect(text, rel(file)).not.toMatch(/process\.env|import\.meta\.env\.(?!DEV\b|PROD\b|MODE\b)/);
    }
  });

  it('the HTML template has no inline script, inline style or event-handler attributes', () => {
    const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\ssrc=/);
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});

describe.skipIf(!hasBuiltUi)('SEC-004 built bundle (dist/ui)', () => {
  const html = hasBuiltUi ? fs.readFileSync(DIST_INDEX, 'utf8') : '';
  const assetsDir = path.join(path.dirname(DIST_INDEX), 'assets');
  const bundle = hasBuiltUi ? walk(assetsDir, ['.js', '.css']).map((f) => fs.readFileSync(f, 'utf8')).join('\n') : '';

  it('index.html is CSP-compatible: every script is external, no inline style, no handlers', () => {
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) {
      expect(s).toMatch(/\ssrc="\/assets\//);
      expect(s.replace(/<script\b[^>]*>/, '').replace('</script>', '').trim()).toBe('');
    }
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    // Every external origin it uses must be allowed by the CSP (Google Fonts styles only).
    const origins = new Set([...html.matchAll(/(?:src|href)="(https?:\/\/[^/"]+)/g)].map((m) => m[1]));
    for (const o of origins) expect(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']).toContain(o);
  });

  it('contains no secrets, password hashes, server internals or dev URLs', () => {
    expect(bundle).not.toMatch(/scrypt\$\d+\$/);
    expect(bundle).not.toMatch(/ADMIN_PASSWORD|ADMIN_EMAIL|DATABASE_FILE|COOKIE_SECURE|SESSION_TTL_HOURS/);
    expect(bundle).not.toMatch(/token_hash|password_hash|node:sqlite|node:crypto/);
    expect(bundle).not.toMatch(/localhost:\d{2,5}|127\.0\.0\.1/);
    expect(bundle).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });

  it('contains none of the values from a local .env, if one exists', () => {
    const envPath = path.join(PROJECT_ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    const secrets = fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .map((l) => /^(ADMIN_EMAIL|ADMIN_PASSWORD)=(.+)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null && m[2].length >= 6)
      .map((m) => m[2]);
    for (const value of secrets) {
      // Report only that a value leaked, never the value itself.
      expect(bundle.includes(value) || html.includes(value), 'a .env value appears in dist/ui').toBe(false);
    }
  });
});

describe('SEC-004 server source and repo hygiene', () => {
  it('only src/shared/config.ts reads process.env', () => {
    const readers = serverFiles.filter((f) => /process\.env/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(readers).toEqual([path.join('src', 'shared', 'config.ts')]);
  });

  it('no server code logs request bodies, headers, cookies or passwords', () => {
    for (const file of serverFiles) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/console\.\w+\(([^;]*)\)/g)) {
        // Check what is logged, not the wording of fixed messages: drop plain string
        // literals and keep only the ${...} expressions of template literals.
        const logged = m[1]
          .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")
          .replace(/`(?:[^`\\]|\\.)*`/g, (tpl) => [...tpl.matchAll(/\$\{([^}]*)\}/g)].map((e) => e[1]).join(' '));
        expect(logged, `${rel(file)}: ${m[0]}`).not.toMatch(/req\.|\bbody\b|headers|cookies?\b|password|token/i);
      }
    }
  });

  it('SQL is never built from template strings with interpolated request values', () => {
    for (const file of walk(path.join(SRC, 'db'), ['.ts'])) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:prepare|exec)\(\s*`([^`]*)`/g)) {
        // Interpolation is only allowed for the module's own constant fragments.
        for (const expr of m[1].matchAll(/\$\{([^}]+)\}/g)) {
          expect(['PRODUCT_SELECT', 'IMAGE_COLUMNS'], `${rel(file)}: ${expr[0]}`).toContain(expr[1].trim());
        }
      }
    }
  });

  it('.env, the database and uploads are git-ignored; only placeholder env examples exist', () => {
    const ignore = fs.readFileSync(path.join(PROJECT_ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    for (const entry of ['.env', 'data/', 'uploads/', '*.db', 'dist/', 'node_modules/']) expect(ignore).toContain(entry);
    const example = fs.readFileSync(path.join(PROJECT_ROOT, 'contracts/env.example'), 'utf8');
    expect(example).toMatch(/^ADMIN_PASSWORD=change-me/m);
    expect(example).toMatch(/^COOKIE_SECURE=false$/m);
  });

  it('every product loadCatalogue() would seed has an amazonUrl that passes isAllowedAmazonUrl', () => {
    const { products } = loadCatalogue();
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) expect(isAllowedAmazonUrl(p.amazonUrl), `${p.slug}: ${p.amazonUrl}`).toBe(true);
  });

  it('every amazonUrl in catalogue/products.json passes isAllowedAmazonUrl (read directly, not via the loader)', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'catalogue/products.json'), 'utf8')) as {
      products?: Array<{ slug?: unknown; amazonUrl?: unknown }>;
    };
    expect(Array.isArray(raw.products)).toBe(true);
    expect(raw.products!.length).toBeGreaterThan(0);
    for (const p of raw.products!) {
      expect(typeof p.amazonUrl, String(p.slug)).toBe('string');
      expect(isAllowedAmazonUrl(p.amazonUrl as string), `${String(p.slug)}: ${String(p.amazonUrl)}`).toBe(true);
    }
  });
});

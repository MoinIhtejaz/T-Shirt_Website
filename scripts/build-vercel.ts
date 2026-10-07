// Orchestrator-owned. Produces .vercel/output (Vercel Build Output API v3):
//   static/              the built site from dist/ui
//   functions/api.func/  the bundled API, with the catalogue and migrations beside it
//   config.json          routing and the security headers for static responses
// Run after `vite build` (see the build:vercel script).
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import type { Request, Response } from 'express';
import { securityHeaders } from '../src/security/index';
import { loadVercelConfig } from '../src/shared/config';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.vercel/output');
const func = path.join(out, 'functions/api.func');
// The bundle sits at the same depth as src/db/seed.ts, so its import.meta.url-relative
// paths (../../catalogue/ and ./migrations/) resolve inside the function directory.
const entry = 'src/db/vercel-entry.mjs';

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(func, { recursive: true });

fs.cpSync(path.join(root, 'dist/ui'), path.join(out, 'static'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/vercel.ts')],
  outfile: path.join(func, entry),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  logLevel: 'warning',
  // express and friends are CommonJS; give the ESM bundle a require() for them.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
fs.cpSync(path.join(root, 'src/db/migrations'), path.join(func, 'src/db/migrations'), { recursive: true });
fs.mkdirSync(path.join(func, 'catalogue'), { recursive: true });
fs.copyFileSync(path.join(root, 'catalogue/products.json'), path.join(func, 'catalogue/products.json'));
fs.cpSync(path.join(root, 'catalogue/images'), path.join(func, 'catalogue/images'), { recursive: true });
fs.writeFileSync(path.join(func, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(
  path.join(func, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: entry, launcherType: 'Nodejs', shouldAddHelpers: false }, null, 2),
);

// Same headers the Express server sends, captured from the security layer itself.
const headers: Record<string, string> = {};
securityHeaders(loadVercelConfig({}))(
  {} as Request,
  { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as Response,
  () => {},
);

fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/(?!api/|uploads/).*', headers, continue: true },
        { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/(api|uploads)/(.*)$', dest: '/api' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log(`Vercel output written to ${path.relative(root, out)}`);

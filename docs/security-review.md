# 2A Marketing security review (SEC-004)

Contract version 2. Owner: security layer. Reviewed 7 October 2026 against the assembled app: `src/app.ts` with every layer wired in, plus the production bundle in `dist/ui`. Updated the same day after the fixes for DEF-001 and DEF-002 landed (both now closed). Refreshed again in round 4, when the site was rebranded to 2A Marketing (2A Marketing Pty Ltd) and the sample catalogue was replaced with the owner's real one.

## Summary

The app is in good shape for a small single-admin catalogue. Authorisation, CSRF, the login limiter, upload handling and output encoding all hold up when tested end to end on the real app, and both `npm audit` runs come back clean.

The review turned up one real problem. In production mode the CSP always carried `upgrade-insecure-requests`, so a site served over plain HTTP from anything other than `localhost` loaded blank: the browser rewrote every script, stylesheet, API call and image to `https://`. That was DEF-001. The directive now follows `COOKIE_SECURE` instead of `NODE_ENV`, and I checked the fix in a browser.

The second finding was smaller. `trust proxy` was hard-coded to `false` with no setting to change it, so putting the site behind an HTTPS reverse proxy would have made every visitor share one login-limiter bucket. That was DEF-002. The glue now reads a `TRUST_PROXY` setting.

## Gate 3 checklist

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Role matrix from `contracts/auth.md` | PASS | `src/api/index.ts:30` mounts the whole admin router as `router.use('/admin', noStore, deps.requireAdmin, admin)`, so a new admin route can't be added without the guard. `src/auth/index.ts:135` puts `requireAdmin` on `/api/auth/me`. `tests/security/authz.fullstack.test.ts` sends all 11 admin operations from the OpenAPI file with no cookie, then with empty, random, SQL-ish, hashed and misnamed cookies, then with an expired session. Every one gets 401 and the database is unchanged. Case changes, trailing and doubled slashes, percent-encoded segments, `OPTIONS` and `HEAD` all get 401 or 404 and never return admin data. |
| 2 | Authorisation enforced on the server | PASS | `requireAdmin` (`src/auth/index.ts:62-88`) hashes the cookie, looks up the session row, checks expiry and loads the admin on every request. `src/ui/admin/RequireAdmin.tsx` only redirects for usability. The authz tests call the API directly with no UI involved. Logout deletes the row, and replaying the old cookie afterwards gets 401. |
| 3 | Inputs validated and parameterised | PASS | Every admin body goes through a zod `strictObject` (`src/services/validation.ts:102`, `:124`, `:149`, `:155`, `:165`). Path ids must match `^[1-9][0-9]*$` and be safe integers (`src/api/params.ts:5-14`). Login uses zod with length limits (`src/auth/index.ts:17-27`). It isn't strict, but `LoginRequest` in the OpenAPI contract doesn't set `additionalProperties: false`, and extra keys are dropped. All SQL in `src/db/repositories.ts` is a constant prepared statement with bound parameters; the only template interpolations are the module's own column-list constants, and `static-audit.test.ts` enforces that. Upload type comes from magic bytes only (`src/services/files.ts:12-19`). Files are written as 32 random hex characters plus the sniffed extension, and deletes use `path.basename` of the stored name (`files.ts:21-30`), so no path is ever built from request input. `amazonUrl` is checked by `isAllowedAmazonUrl` on create and update (`validation.ts:137-141`). `xss.fullstack.test.ts` shows `javascript:`, `data:`, `http:`, look-alike, userinfo and path-smuggled URLs all get 400 on both create and update. |
| 4 | No secrets in source, logs or bundle | PASS | Only `src/shared/config.ts` reads `process.env`. `.env` is git-ignored (`.gitignore:5`, confirmed with `git check-ignore`), along with `data/`, `uploads/`, `*.db` and `dist/`. The `ADMIN_EMAIL` and `ADMIN_PASSWORD` values from the local `.env` don't appear anywhere in `src/`, `tests/`, `dist/ui`, `contracts/`, `docs/` or `README.md`. The only scrypt string in source is `DUMMY_HASH` (`src/auth/password.ts:83`), which is there by design: it's the hash of a random secret nobody holds, used to even out login timing. Test files contain test-only passwords. The bundle has no hashes, env names, `localhost` URLs, private keys or server-only modules. The server has five `console` calls. None of them log request bodies, headers, cookies or credentials, and the error handler logs only unexpected 5xx errors (`src/shared/http.ts:54`). |
| 5 | Dependency audit | PASS | `npm audit --omit=dev`: found 0 vulnerabilities. `npm audit`: found 0 vulnerabilities. No exceptions needed. |

## Round-1 follow-ups

| Item | Result | Evidence |
|---|---|---|
| No `dangerouslySetInnerHTML` or `innerHTML` in `src/ui` | PASS | Grep finds none, and neither does `static-audit.test.ts`, which also checks for `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` and `srcdoc`. The five `innerHTML` hits in the minified bundle are all inside React DOM itself. |
| Buy link `rel` | PASS | `src/ui/pages/ProductPage.tsx:135-139` has `target="_blank" rel="noopener noreferrer sponsored"`. Every other `target="_blank"` link in `src/ui` has `noopener noreferrer`. Both a static test and a rendered jsdom test cover this. |
| CSP compatibility of `dist/ui/index.html` | PASS | One external module script under `/assets/`, two stylesheets (one local, one Google Fonts). No inline script, inline style, `style=` attribute or event handler. The only external origins are the two Google Fonts hosts the CSP allows. I loaded the production build in a browser on `localhost` and it rendered with no CSP violations. |
| Seeded Amazon URLs pass `isAllowedAmazonUrl` | PASS | The seed now loads `catalogue/products.json`, and `loadCatalogue` rejects any product whose `amazonUrl` fails `isAllowedAmazonUrl` before anything is written (`src/db/seed.ts:173-175`). All seven current links are Amazon search URLs (`https://www.amazon.com.au/s?k=...`). They pass the validator, but they're placeholders until the owner supplies real listing URLs. `static-audit.test.ts` checks the links twice: once through `loadCatalogue()` and once by reading `products.json` directly, so a bug in the loader can't hide a bad link. `uploads.fullstack.test.ts` also seeds the real app, reads every product back through the public API and runs the validator on what comes out. |
| XSS via name, description or alt text | PASS | The API stores and returns hostile text unchanged as `application/json; charset=utf-8` with `nosniff` (`xss.fullstack.test.ts`). The production HTML shell is static and never reflects stored data. In jsdom, product, shop and admin pages render `<script>`, `<img onerror>` and `<svg onload>` payloads in names, descriptions, colour names, category names and alt text as literal text. No script, handler attribute or `javascript:` link appears in the DOM (`xss-render.test.tsx`). |
| Seeded catalogue images handled safely | PASS | The seed copies the catalogue's 7 JPEG photos into the upload directory. Each file has to pass the same JPEG, PNG or WebP magic-byte check as an upload (`src/db/seed.ts:67-68`, `:135`), along with the field limits and the Amazon link check, and the whole catalogue is validated before any write. Files get random `<32 hex>.jpg` names (`seed.ts:296`). Inserts run in one `BEGIN IMMEDIATE` transaction, and on failure it rolls back and deletes any files already copied (`seed.ts:264-308`). `src/app.ts:41-52` sets `default-src 'none'; style-src 'unsafe-inline'; sandbox` and `nosniff` on every `/uploads` response, hit or miss. `uploads.fullstack.test.ts` seeds the real app and checks that every seeded photo is served as `image/jpeg` with the sandbox CSP, `nosniff`, CORP `same-origin` and `X-Frame-Options: DENY`, starts with the JPEG bytes `FF D8 FF`, and has a server-generated name. The sample SVG placeholders from earlier rounds are gone. |
| Session cookie attributes in the real app | PASS | `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=43200`, no `Domain`, a 32-byte token, and `Secure` only when `COOKIE_SECURE=true`, on both login and logout (`headers.fullstack.test.ts`). |
| Login limiter mounted before the auth router | PASS | `src/app.ts:35` comes before `src/app.ts:36`. On the real app the 11th attempt gets 429 with a `Retry-After` of 1 to 900 seconds, even with the right password, and no cookie or session row is created. Successful logins count toward the limit. Path variants (`/login/`, `/API/AUTH/LOGIN`) share the same bucket, and spoofed `X-Forwarded-For` or `X-Real-IP` headers don't get a fresh one. The CSRF guard runs first (`src/app.ts:34`), so a request without the header gets 403 and isn't counted. That's fine, because it can't log in either. |
| `trust proxy` | PASS after DEF-002 | `src/app.ts:28` now calls `app.set('trust proxy', config.trustProxy)`. The default is `false`, which is correct when Node faces the internet directly and is why spoofing `X-Forwarded-For` doesn't help an attacker (the limiter tests still pass). Behind a proxy, `TRUST_PROXY` can be set. See DEF-002 below. |
| `upgrade-insecure-requests` in production over HTTP | PASS after DEF-001 | Was a FAIL at review time. See DEF-001 below. |

## Defects

Both defects from this review are fixed.

### DEF-001: production CSP breaks the site on any plain-HTTP host (medium, fixed)

- Layer: security (SEC-002). File: `src/security/headers.ts:20-22`, used at `:31`.
- Problem: `buildCsp` added `upgrade-insecure-requests` whenever `NODE_ENV=production`, whatever the transport, and `npm start` always sets `NODE_ENV=production`.
- What I saw: I ran the production server with `COOKIE_SECURE=false` and opened it at `http://192.168.1.101:4387/` in Chromium. The HTML loaded, but the browser requested `https://192.168.1.101:4387/assets/index-*.js` and `.css`, both failed with `ERR_SSL_PROTOCOL_ERROR`, and `#root` stayed empty. At `http://localhost:4387/` it worked, because Chromium doesn't upgrade `localhost`. That makes the bug easy to miss in development and certain to show up when someone tests on a phone over the LAN or deploys to a host without TLS.
- Security impact: none directly, since it fails closed. The risk is operational. The quickest "fix" someone reaches for is running in development mode in production, or deleting the CSP.
- Fix: `src/security/headers.ts` now calls `buildCsp(config.cookieSecure)`, so `upgrade-insecure-requests` is sent only when `COOKIE_SECURE=true`. That's the same switch that controls HSTS, and it means "served over HTTPS" whatever `NODE_ENV` says. The header section and T4 of `docs/threat-model.md` describe the new rule.
- Tests: `tests/security/headers.test.ts` checks all four combinations of `isProduction` and `cookieSecure`, plus `buildCsp` directly. `tests/security/headers.fullstack.test.ts` checks the real app three ways. In production with `COOKIE_SECURE` off, the shell, API, uploads and built assets carry neither the directive nor HSTS. In production with it on, the shell, `/shop`, the API and the assets get both, and `/uploads` keeps its sandbox policy. In development with it on, the directive is still present. The old `it.todo` is gone.
- Rechecked in a browser: the production build at `http://192.168.1.101:4387/` with `COOKIE_SECURE=false` now loads its JS, CSS and API calls over `http://` and renders the home page.

### DEF-002: no way to configure `trust proxy` (low, fixed)

- Layer: glue. Files: `src/app.ts:28`, `src/shared/config.ts`, `contracts/env.example`.
- Problem: going live over HTTPS usually means a TLS-terminating proxy (Caddy, nginx, a platform load balancer). Behind one, `req.ip` is the proxy's address for every visitor, so the login limiter has one shared bucket, and one person making 10 bad guesses locks the real admin out for 15 minutes. The threat model lists this as accepted risk 3 and assigned the fix to the glue, but at review time `trust proxy` was hard-coded to `false` and changing it meant editing code.
- Fix (glue): `TRUST_PROXY` is now part of `AppConfig` and `contracts/env.example` (contract version 3), and `src/app.ts:28` passes it to `app.set('trust proxy', ...)`. It accepts `false` (the default), a hop count from 1 to 10, `loopback`, `linklocal` or `uniquelocal`. It refuses `true`, because Express would then believe any client-supplied `X-Forwarded-For` and the limiter could be bypassed. Parsing is covered by `tests/shared/config.test.ts`.

## Accepted risks

These are carried over from the threat model and still apply. Nothing in the assembled system made them worse.

1. The login limiter lives in memory per process and resets on restart.
2. The limiter works per IP with no per-account lockout, so an attacker with many addresses gets 10 guesses per address per window.
3. There's no MFA and no password reset flow. Re-running the seed with a new `ADMIN_PASSWORD` doesn't revoke existing sessions (the README describes this as the way to change the password).
4. Sessions last a fixed 12 hours with no idle timeout.
5. There's no audit log of admin changes.
6. Public endpoints have no rate limit.
7. Google Fonts load from Google, which sees visitor IPs.
8. Amazon short links (`amzn.to`, `amzn.asia`) are trusted to redirect within Amazon.
9. A real PNG, JPEG or WebP header followed by HTML is accepted, because the check is on magic bytes only and there's no re-encoding. It's stored with the image extension and served as `image/png` (or similar) with `nosniff` and the sandbox CSP, so it can't run. The uploads test covers this case.

## Smaller observations

None of these need fixing before launch.

- `docs/threat-model.md` T7 used to say public slugs are pattern-checked on the server. They aren't: `GET /api/products/{slug}` passes the raw string to a prepared statement, which is safe and returns 404. T7 has been corrected.
- `res.json` doesn't escape `<`, `>` and `&`. That's safe here because JSON is never inlined into HTML, but `app.set('json escape', true)` in `src/app.ts` would be a one-line extra layer of protection.
- `express.static` for `/uploads` redirects `/uploads/<dir>` to `/uploads/<dir>/`. The upload directory never contains subdirectories, and the redirect stays on the same origin (tested), so the only effect is noise. `redirect: false` would remove it.
- A stale `.env.example` (contract version 1) sits at the project root next to `contracts/env.example`. It holds only placeholders.
- Over plain HTTP, browsers log that `Cross-Origin-Opener-Policy` is ignored on an untrustworthy origin. It starts working once the site is on HTTPS.

## Before going live

1. Serve the site over HTTPS only, and redirect port 80 to 443 at the proxy.
2. Set `COOKIE_SECURE=true` in `.env` once the site is on HTTPS. It adds `Secure` to the session cookie, turns on HSTS and adds `upgrade-insecure-requests` to the CSP. If you start in production with it off, `src/main.ts` logs a warning at startup. Don't set it while the site is still on plain HTTP: the cookie won't be sent and the browser will try to upgrade every request.
3. If a TLS-terminating proxy (Caddy, nginx, a platform load balancer) sits in front of the app, set `TRUST_PROXY=1` (one hop) so the login limiter sees real client IPs. Leave it at `false` if Node faces the internet directly. Never try to set it to `true`, which the config refuses anyway. Afterwards, check that two different client IPs get separate login budgets.
4. Pick a strong admin password (the seed enforces 12 characters minimum, but longer is better) and don't reuse it anywhere else. After changing it, clear the `sessions` table.
5. Back up `data/saltline.db` and the `uploads/` directory together, because image rows point at files. With WAL mode on, use `sqlite3 data/saltline.db ".backup backup.db"` or stop the app before copying, rather than copying the live file. Keep at least one copy off the server and test a restore.
6. Make sure `.env`, `data/` and `uploads/` are readable only by the app's user, and that `.env` never ends up in a deploy artifact or container image layer.
7. Run `npm audit --omit=dev` before each release, and look at any new dependency before adding it.
8. Put basic request rate limiting in front of the public endpoints at the proxy or CDN.
9. Replace the placeholder Amazon search links in `catalogue/products.json` (or in the admin panel) with the real listing URLs. A search link sends buyers to a results page that can show other sellers' shirts, and the validator only checks that the link stays on Amazon, not that it points at the right product.

## Tests added in this round

All in `tests/security/`, using `createApp(testConfig({ uploadDir: <mkdtemp> }))`:

- `fullstack.ts`: shared harness (not a test file).
- `authz.fullstack.test.ts`: the role matrix, forged and expired sessions, path tricks, logout revocation, draft leakage, and a positive control.
- `csrf.fullstack.test.ts`: every write without the header (logged in) gets 403 with no side effects. Also covers multipart, simple form content types, wrong header values, method override and the absence of CORS.
- `loginLimiter.fullstack.test.ts`: 11th attempt gets 429 with no session created, successes count, header spoofing, path variants, ordering against the CSRF guard, and scope.
- `xss.fullstack.test.ts`: stored payloads come back verbatim as JSON with `nosniff`, hostile `amazonUrl` values are rejected, SQL metacharacters do nothing, and the production shell doesn't reflect stored data.
- `uploads.fullstack.test.ts`: SVG, HTML, XHTML, GIF, PDF, empty files and fake PNG prefixes get 415 with nothing written. Also covers client filenames, the polyglot case, headers and magic bytes on the seeded catalogue JPEGs, traversal, dotfiles, directory redirects, seeded links and writes to `/uploads`.
- `headers.fullstack.test.ts`: headers on `/`, `/api/*`, `/uploads/*` and built assets in development and production configs, error bodies with no internals, `no-store`, cookie attributes, and HSTS with `COOKIE_SECURE`. Also has the DEF-001 regression tests for both values of `COOKIE_SECURE`.
- `xss-render.test.tsx`: jsdom rendering of hostile text on product, shop and admin pages, and the Buy link.
- `static-audit.test.ts`: raw-HTML sinks, `rel` on new-tab links, UI imports, template and bundle CSP compatibility, secrets in the bundle, `process.env` readers, logging, SQL construction, `.gitignore`, and the catalogue's Amazon links (through the loader and straight from `products.json`). The logging check looks at what gets logged (variables and `${}` expressions), not at the wording of fixed messages like the startup warning in `main.ts`.

The production-mode tests skip themselves when `dist/ui` hasn't been built.

# Saltline threat model

Contract version 1. Owner: security layer (SEC-001). Reviewed again in SEC-004 once the system is assembled (see `docs/security-review.md`). Updated for DEF-001.

Saltline is a small catalogue site. Visitors browse anonymously and click through to Amazon to buy. One admin signs in to manage products, categories and images. The site takes no payments and stores no visitor data, so the main things worth attacking are the admin account and the trust visitors place in the "Buy on Amazon" button.

## Scope

In scope: the Express API under `/api`, the `/uploads` static route, the React SPA served from the same origin, the SQLite file and the upload directory on local disk, and the outbound Amazon links.

Out of scope for v1: hosting, TLS termination, reverse proxies, backups and the operating system. Where a risk depends on how the site is deployed, the table below says so.

## Assets

| Asset | Why it matters |
|---|---|
| Admin credentials (email and scrypt password hash) | Anyone holding them controls every product and every outbound link |
| Admin session token (`saltline_session` cookie) | Equivalent to the password for up to 12 hours |
| Product data, especially `amazonUrl` | Visitors trust the Buy button. A changed URL sends them to a phishing page |
| Uploaded images on disk | Served from our origin, so a hostile file could run script as us if served wrongly |
| Site availability | It's the shop window. Downtime means lost Amazon referrals |
| Secrets in `.env` (`ADMIN_PASSWORD` used by the seed) | A leaked seed password is a leaked admin password |
| Brand reputation | Defacement or malware on the site hurts the label more than the data loss would |

## Actors

| Actor | Access | Intent |
|---|---|---|
| Visitor | Public pages and public GET endpoints | Benign |
| Anonymous attacker | Same as a visitor, plus arbitrary HTTP requests and their own websites | Take over the admin, deface, redirect buyers, knock the site over |
| Admin | Full write access after login | Benign, but can be phished, can reuse a weak password, can paste a bad link |
| Attacker holding a stolen admin session | Full write access until the session expires | Swap Amazon links for phishing pages, upload hostile files |
| Malicious or compromised npm package | Code execution at install or run time | Anything the process can do |

## Trust boundaries

1. Browser to API. Everything in a request is untrusted: path, query, headers, cookies, JSON body and multipart body. The API validates it all on the server. The SPA's checks are only for usability.
2. Admin to API. The admin is trusted only after the session cookie checks out in `requireAdmin`. State-changing requests also have to pass the CSRF guard.
3. API to disk. The API writes image files and the SQLite database. File names come from the server, never from the client, and the upload directory is the only place the API writes images.
4. Disk back to the browser. Files under `/uploads` are served on our own origin, so they're treated as hostile content even though only the admin can upload them.
5. Site to Amazon. Outbound links leave our origin. We control only which URL we hand out and how the browser opens it.

## Threats and mitigations

Likelihood and impact are rated low, medium or high for this deployment (one admin, small catalogue, local or single-server hosting). STRIDE letters: S spoofing, T tampering, R repudiation, I information disclosure, D denial of service, E elevation of privilege.

Owner names the layer that has to implement or keep the mitigation: auth, database, backend, frontend, security or glue (the orchestrator-owned `src/app.ts`, `src/shared/**` and config).

| ID | Threat | STRIDE | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|---|
| T1 | Brute force or credential stuffing against `POST /api/auth/login` | S, E | Medium | High | Per-IP fixed-window limiter, 10 attempts per 15 minutes, 429 `RATE_LIMITED` with `Retry-After`. Passwords hashed with scrypt (N=16384), so offline cracking of a stolen hash is slow. Seed refuses passwords shorter than 12 characters | security (limiter), glue (mounts it on the login route; `loadSeedAdmin` length check), auth (scrypt) |
| T2 | Account enumeration through login errors or timing | I | Medium | Low | Same message and code for unknown email and wrong password. A dummy `verifyPassword` runs for unknown emails so timing matches | auth |
| T3 | Session theft through XSS | S, E | Low | High | Cookie is HttpOnly, so script can't read it. Strict CSP (`script-src 'self'`, no inline script) limits XSS in the first place. See T6 and T7 | auth (cookie), security (CSP), frontend (no raw HTML) |
| T4 | Session theft on the network | S | Low locally, high on plain HTTP hosting | High | `COOKIE_SECURE=true` sets the Secure flag, turns on HSTS and adds `upgrade-insecure-requests` to the CSP. Must be served over HTTPS once hosted | glue (config), auth (cookie flag), security (HSTS) |
| T5 | Session fixation | S | Low | High | Login always mints a fresh 32-byte random token. The server never accepts a client-chosen token because only `sha256(token)` rows it created exist. Logout deletes the row | auth |
| T6 | Stored XSS through product name, description, colour name, category name or image alt text | T, E | Medium | High | Backend stores plain text and validates lengths. The frontend renders through React text nodes only: no `dangerouslySetInnerHTML`, no `innerHTML`, description newlines split into paragraphs in code. CSP blocks inline and third-party script as a second layer | frontend (rendering), backend (validation), security (CSP) |
| T7 | DOM XSS through URL or query parameters (`/shop?category=`, `/shirts/<slug>`) | T, E | Low | High | React escapes interpolated values. The public slug path parameter isn't pattern-checked: it's bound into a prepared statement, so any value is inert and an unknown one is a 404. Admin-supplied slugs are pattern-checked on write. No `eval`, no `new Function`, no HTML built from strings | frontend, backend |
| T8 | CSRF: a hostile site makes the admin's browser create, edit or delete products, or log in as the attacker | T, E | Medium | High | Two layers. The session cookie is `SameSite=Strict`, and `csrfGuard` rejects any non-GET/HEAD/OPTIONS request under `/api` without `X-Saltline-CSRF: 1`. A cross-origin page can't set that header without a CORS preflight, and the server enables no CORS | security (guard), auth (SameSite), frontend (sends header), glue (no CORS) |
| T9 | Malicious image upload: HTML, SVG or a polyglot that runs script when opened from `/uploads` | T, E | Low (admin-only upload) | High | Type decided by magic bytes, never by name or client MIME. Only JPEG, PNG and WebP are accepted, so SVG and HTML are rejected outright. Files are stored as `<32 random hex>.<jpg|png|webp>`, so the extension always matches the sniffed type. `/uploads` responses carry `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `nosniff`, so even a polyglot opened directly can't run script on our origin | backend (sniffing, naming), glue (sandbox headers), security (nosniff baseline) |
| T10 | Path traversal through upload names or `/uploads/../` requests | T, I | Low | High | Client filenames are thrown away. Deletes look up the stored filename from the database by product and image id, never from the request path. `/uploads` uses `express.static` with dotfiles denied and no directory index | backend, database (filename column), glue |
| T11 | Phishing or open redirect through `amazonUrl` after a stolen session or a pasted look-alike | T, S | Medium | High | `isAllowedAmazonUrl` accepts only `https://` URLs on six exact hosts. It rejects userinfo, ports, look-alike and homograph hosts, whitespace and control characters, backslashes and non-ASCII. The backend calls it on every write. The Buy button opens in a new tab with `rel="noopener noreferrer sponsored"`. The seed must use URLs that pass the same check | security (validator), backend (enforces on write), frontend (rel, renders only API values), database (seed URLs) |
| T12 | Reverse tabnabbing from the Amazon tab | T | Low | Medium | `rel="noopener"` on the Buy link, plus `Cross-Origin-Opener-Policy: same-origin` | frontend, security |
| T13 | SQL injection through any field, filter or path parameter | T, I, E | Low | High | All queries use `node:sqlite` prepared statements with bound parameters. No SQL is built from strings. Path ids are validated as positive integers before reaching the repositories | database, backend |
| T14 | Clickjacking the admin panel | T | Low | Medium | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` on every response | security |
| T15 | Draft products leaking through the public API | I | Medium | Low | Public routes always query `status = 'published'` and strip `status`, `categoryId` and timestamps from responses | backend |
| T16 | Secrets committed to the repo | I | Medium | High | `.env` is git-ignored and only `contracts/env.example` with placeholder values is committed. Only `src/shared/config.ts` reads `process.env`. The admin password is read by the seed only and never held by the running server | glue |
| T17 | Secrets or internal URLs in the client bundle | I | Low | Medium | The SPA reads no `VITE_*` secrets and talks to the API on the same origin through relative paths. Nothing server-side is imported into `src/ui` | frontend, glue |
| T18 | Error messages leaking stack traces, SQL or file paths | I | Medium | Low | Every error goes through `sendError`. Unknown errors become 500 `INTERNAL` with a fixed message and are logged server-side only. `x-powered-by` is disabled | glue, backend |
| T19 | Raw session token or password in logs | I | Low | High | Only the token hash is stored. No layer may log login request bodies or cookie headers | auth, glue |
| T20 | DoS through large JSON bodies | D | Medium | Medium | `express.json` limit of 100 kB, 413 `PAYLOAD_TOO_LARGE` | glue |
| T21 | DoS through large or many uploads | D | Low (admin-only) | Medium | Multer limit of 5 MB and a single file per request, 413 `FILE_TOO_LARGE`. At most 8 images per product. Upload routes sit behind `requireAdmin`, so anonymous users can't reach them | backend |
| T22 | DoS through request floods on public endpoints | D | Medium | Medium | Out of scope for v1. The catalogue is small and cheap to serve. A hosted deployment should put a reverse proxy or CDN with rate limits in front | glue (deployment) |
| T23 | Memory growth in the rate limiter from many client IPs | D | Low | Medium | Expired buckets are swept once per window, and the store is capped at 50,000 entries with oldest-first eviction | security |
| T24 | MIME sniffing turning a JSON or image response into HTML | T | Low | Medium | `X-Content-Type-Options: nosniff` on every response. JSON is always sent with `application/json` | security, glue |
| T25 | Mixed content or third-party script injection | T | Low | Medium | CSP allows scripts only from `'self'`. Styles and fonts are allowed from Google Fonts only. `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` | security, frontend (no external scripts, no inline `<style>` blocks) |
| T26 | Malicious or vulnerable npm dependency | T, E | Medium | High | Small dependency set with no helmet or rate-limit packages (written by hand). Keep and commit `package-lock.json`. Run `npm audit` before release and review new dependencies at the gate. Seed and dev tooling stay in devDependencies | glue, all layers (no new deps without review) |
| T27 | Repudiation: no record of what the admin changed | R | Low | Low | `createdAt` and `updatedAt` on products. There's one admin, so there's no audit log in v1 | database |
| T28 | Browser features abused by injected content (camera, mic, location) | E | Low | Low | `Permissions-Policy: camera=(), microphone=(), geolocation=()` | security |
| T29 | Referrer leaking admin paths or query strings to Amazon or Google Fonts | I | Low | Low | `Referrer-Policy: strict-origin-when-cross-origin` and `noreferrer` on the Buy link | security, frontend |
| T30 | Cross-origin sites embedding our images or API responses | I | Low | Low | `Cross-Origin-Resource-Policy: same-origin` | security |

## Security headers set by `securityHeaders`

Every response gets these, including errors and 404s:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

When `COOKIE_SECURE=true` the CSP ends with `; upgrade-insecure-requests` and HSTS (`max-age=15552000; includeSubDomains`) is sent. Both follow `COOKIE_SECURE`, which means "this site is served over HTTPS", and neither depends on `NODE_ENV`.

That's deliberate. Over plain HTTP, `upgrade-insecure-requests` makes the browser rewrite every script, stylesheet, API call and image to `https://`, and on a host without TLS the page loads blank. Chromium exempts `localhost`, so this only shows up on a LAN IP or an HTTP-only host (DEF-001 in `docs/security-review.md`). HSTS over plain HTTP would do nothing useful and could lock a developer's browser into HTTPS for `localhost`.

The middleware runs first, so a later route can replace the CSP. The glue does this for `/uploads`, which gets the stricter sandboxed policy described in T9.

A note for the frontend: `style-src 'self'` blocks `<style>` blocks and `style="..."` attributes in HTML sent by the server. React's `style` prop is applied through the CSSOM after load and isn't affected. Vite's production build emits CSS as files, which is fine. The Vite dev server isn't behind this middleware, so dev mode isn't affected either.

## Accepted risks

These are known and accepted for v1. Each one should be revisited before the site is hosted publicly.

1. The login rate limiter lives in memory. A restart resets every counter, and if the app ever runs as several processes, each one keeps its own count. Combined with scrypt and the 12-character minimum, an attacker still gets very few guesses.
2. The limiter is per IP only. An attacker with many addresses (a botnet, or a large IPv6 range) gets 10 guesses per address per window. There's no per-account lockout, because a lockout would let anyone lock the real admin out.
3. If the app is put behind a reverse proxy without changing `trust proxy`, every client shares the proxy's IP. One attacker could then use up the login budget and block the admin for 15 minutes. Setting `trust proxy` correctly is a deployment task for the glue.
4. There's no MFA. A phished password is a full compromise until it's changed.
5. There's no password reset flow. The admin changes the password by re-running the seed with a new `ADMIN_PASSWORD`. Existing sessions are not revoked when that happens, so after a suspected compromise the operator should also clear the `sessions` table.
6. Sessions last a fixed 12 hours with no idle timeout and no "sign out everywhere" button.
7. There's no audit log of admin changes.
8. Public endpoints have no rate limit, and there's no protection against volumetric DoS in v1.
9. Google Fonts are loaded from Google's servers, which reveals visitor IPs to Google and adds a third-party dependency for styles. Self-hosting the fonts would remove both.
10. Amazon short links (`amzn.to`, `amzn.asia`) redirect on Amazon's side. We trust Amazon's redirector to stay on Amazon. A short link could, in principle, point at any Amazon page the admin chose.

## Verification

`tests/security/**` covers the security layer: exact header values, the CSP override on a later route, CSRF pass and reject cases, the rate limit window, `Retry-After` rounding and bucket pruning, and more than 70 accept and reject cases for `isAllowedAmazonUrl`. SEC-004 checks the other layers' mitigations listed above once they are assembled, and files any gap as a defect against the owning layer.

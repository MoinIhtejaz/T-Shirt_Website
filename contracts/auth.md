# Auth contract (version 2)

## Model

Single tenant with one role: **admin**. Visitors are anonymous and never authenticate. There may be several rows in `admins`, but every admin has identical permissions.

## Password storage

- `hashPassword(plain)` uses Node's `crypto.scrypt` with a 16-byte random salt, keylen 64, N=16384, r=8, p=1.
- Stored format: `scrypt$16384$8$1$<salt base64url>$<hash base64url>`.
- `verifyPassword` parses the stored parameters and compares with `crypto.timingSafeEqual`. A malformed hash returns `false` and never throws.
- On login with an unknown email, the code still runs one `verifyPassword` against a fixed dummy hash, so response timing doesn't reveal whether the email exists.
- The minimum password length (12) is enforced by the seed script. Login doesn't enforce it.

## Session token

- Raw token: 32 bytes from `crypto.randomBytes`, base64url encoded. This is the cookie value.
- Stored: `sessions.token_hash = sha256(rawToken)` as hex. The raw token never touches the database or logs.
- Lifetime: `SESSION_TTL_HOURS` (default 12), fixed from creation, with no sliding refresh. Expired rows are treated as absent and deleted when read. `deleteExpired()` runs once at startup.
- Login always creates a **new** session, which prevents session fixation. Logout deletes the session row.

## Cookie

| Attribute | Value |
|---|---|
| Name | `saltline_session` |
| HttpOnly | yes |
| SameSite | `Strict` |
| Secure | `config.cookieSecure` |
| Path | `/` |
| Max-Age | TTL in seconds |

Logout clears it with the same name, path and attributes.

## Routes (mounted at `/api/auth` by the glue)

| Method | Path | Auth | Success | Failures |
|---|---|---|---|---|
| POST | `/api/auth/login` | none | 200 `SessionResponse`, sets cookie | 400 `VALIDATION_FAILED` (email not a string or not 1–254 chars, password not a string or not 1–200 chars), 401 `INVALID_CREDENTIALS`, 429 `RATE_LIMITED` (security middleware, mounted by the glue) |
| POST | `/api/auth/logout` | none needed | 204, clears cookie | none. Logout is idempotent |
| GET | `/api/auth/me` | session | 200 `SessionResponse` | 401 `UNAUTHENTICATED` |

Email comparison is case-insensitive (the column is `COLLATE NOCASE`). Trim the email before lookup.

## Middleware

`requireAdmin`: reads the cookie, hashes it, looks up the session, checks expiry, loads the admin, sets `req.admin: AdminUser` and calls `next()`. Otherwise it responds 401 `UNAUTHENTICATED`. It never redirects, because it serves a JSON API.

## Permission matrix

| Resource / action | Visitor | Admin |
|---|---|---|
| `GET /api/health`, `/api/categories`, `/api/products`, `/api/products/{slug}` (published only) | ✅ | ✅ |
| `GET /uploads/*` | ✅ | ✅ |
| `POST /api/auth/login`, `/api/auth/logout` | ✅ | ✅ |
| `GET /api/auth/me` | 401 | ✅ |
| Anything under `/api/admin/**` | 401 | ✅ |

All authorisation happens on the server. The frontend's route guard is only a convenience.

## CSRF

Two layers, both required:
1. `SameSite=Strict` on the session cookie.
2. The `csrfGuard` security middleware rejects any non-GET/HEAD/OPTIONS request under `/api` that lacks the `X-Saltline-CSRF: 1` header, with 403 `CSRF_REJECTED`. A cross-origin page can't set a custom header without a CORS preflight, and the server enables no CORS. The frontend API client sends this header on every non-GET request, login included.

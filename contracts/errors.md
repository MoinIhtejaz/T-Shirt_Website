# Error contract (version 5)

Every non-2xx JSON response from `/api/**` uses this envelope:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Some fields need fixing.", "details": [ { "field": "amazonUrl", "message": "Must be an Amazon link." } ] } }
```

- `code` is one of the codes below. Clients branch on `code`, never on `message`.
- `message` is short, plain English, and safe to show to a user. It never contains stack traces, SQL or file paths.
- `details` appears only with `VALIDATION_FAILED`. `field` is a dotted path into the request body (`colours.1.hex`).
- Use `sendError()` or throw `HttpError` from `src/shared/http.ts`. Don't build the envelope by hand.

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | The body or a parameter fails the schema. Includes an unknown `categoryId` and a non-numeric `{id}` path parameter |
| `INVALID_JSON` | 400 | The request body isn't parseable JSON (handled by the glue error handler) |
| `UNAUTHENTICATED` | 401 | An admin route is called without a valid session, or `GET /api/auth/me` has no session |
| `INVALID_CREDENTIALS` | 401 | Login with an unknown email or wrong password. The same message for both: "Email or password is incorrect." |
| `CSRF_REJECTED` | 403 | A non-GET/HEAD/OPTIONS `/api` request without the `X-Saltline-CSRF: 1` header |
| `NOT_FOUND` | 404 | An unknown route under `/api`, a missing or draft product on the public API, a missing admin resource |
| `SLUG_TAKEN` | 409 | Creating or updating a product or category with a slug already in use. `details` has `[{field:"slug"}]` |
| `IMAGE_LIMIT_REACHED` | 409 | Uploading a 9th image to a product |
| `FILE_TOO_LARGE` | 413 | An uploaded image is over 5 MB |
| `PAYLOAD_TOO_LARGE` | 413 | A JSON body is over 100 kB (handled by the glue error handler) |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | An upload that isn't JPEG, PNG or WebP by **content** (magic bytes), or a missing `image` field |
| `READ_ONLY` | 403 | Any non-GET/HEAD/OPTIONS `/api` request while the server runs read-only (`READ_ONLY=true`, always on Vercel). Checked before CSRF, by the glue |
| `RATE_LIMITED` | 429 | Too many login attempts. Sets a `Retry-After` header in seconds |
| `INTERNAL` | 500 | Anything unexpected. The message is always "Something went wrong." The detail is logged on the server only |

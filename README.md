# 2A Marketing

The showcase website for 2A Marketing Pty Ltd, a Sydney t-shirt business. Visitors browse the range and buy on Amazon. The owner logs in at `/admin` to add shirts, upload photos and publish them.

All brand copy lives in `src/ui/content/copy.ts`. The starting catalogue (7 shirts, their photos and 4 categories) lives in `catalogue/`, and `npm run seed` loads it into an empty database. The original, unedited product photos are kept in `catalogue/originals/`.

## Run it locally

You need Node 22.13 or newer.

```bash
npm install
```

Copy the example settings and choose your own admin email and password (at least 12 characters):

```bash
cp .env.example .env
```

Create the database, the admin account and the starting catalogue:

```bash
npm run seed
```

Start the API and the site together:

```bash
npm run dev
```

Open http://localhost:5173 for the shop and http://localhost:5173/admin to log in.

To change the admin password, edit `ADMIN_PASSWORD` in `.env` and run `npm run seed` again. Existing shirts are left alone.

## Production build

```bash
npm run build
```

```bash
npm start
```

`npm start` serves the site and the API from one port (3001 by default). Put it behind HTTPS before going live, and set `COOKIE_SECURE=true` in `.env` once it is.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

## How the code is laid out

The project was built by separate agents, one per layer. Each layer only talks to the others through the files in `contracts/`.

| Folder | What it does |
|---|---|
| `contracts/` | The API spec, database schema, shared types, auth rules and error codes |
| `src/db/` | SQLite schema, migrations, queries and the seed script |
| `src/auth/` | Admin login, sessions and the admin-only check |
| `src/security/` | Security headers, CSRF check, login rate limit, Amazon link check |
| `src/api/`, `src/services/` | The JSON API and the rules behind it (validation, slugs, image uploads) |
| `src/ui/` | The React site and admin panel |
| `src/app.ts`, `src/shared/` | Wiring that connects the layers |
| `catalogue/` | The starting product list, its photos and the original photos |
| `docs/` | Requirements, backlog, threat model, security review and the build report |

Product photos are stored in `uploads/` and the database in `data/`. Both are ignored by git, so back them up separately.

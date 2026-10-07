# Build report: 2A Marketing

Built 6 to 7 October 2026 with the orchestrated-build skill. One orchestrator wrote the requirements, backlog and contracts. Five agents (database, auth, security, backend, frontend) built the layers in three rounds, and the orchestrator integrated their work and ran the gates.

## What you have

The showcase website for 2A Marketing Pty Ltd, a Sydney t-shirt business. Visitors browse shirts and click through to Amazon to buy. There is no cart or checkout on the site, which was your call: selling happens on Amazon.

Public pages:

- Home: hero, featured shirts and a short brand teaser
- Shop: every published shirt, with category filters (Graphic, Essentials, Sydney Icons)
- Shirt page: photo gallery, AUD price, colours, sizes, description and a "Buy on Amazon" button
- About and Size Guide
- A 404 page for unknown addresses and unpublished shirts

The admin panel at `/admin` has one login for you. From there you can add and edit shirts, choose draft or published, mark shirts as featured on the home page, upload up to 8 photos per shirt (with alt text and ordering), and manage categories.

The design is a clean coastal look: sand, harbour blue, off-white, with coral as the one accent colour. It works on phones down to 360px wide. Your 7 shirts come pre-loaded from `catalogue/`.

## How it was checked

| Gate | Result |
|---|---|
| Ownership: each agent wrote only inside its own folders | Pass |
| Contract conformance: every route in the API spec exists, and admin routes refuse visitors | Pass |
| Typecheck | Pass, no errors |
| Tests | 396 passing across 26 files, none skipped |
| Production build | Pass |
| Core flow in a real browser (log in, create a shirt, upload a photo, publish, see it in the shop, Buy button links to Amazon) | Pass |
| Security review of the assembled system | Pass after two fixes (below) |
| Dependency audit | 0 known vulnerabilities |

All 20 stories in `docs/backlog.yaml` are complete.

## Problems found and fixed during integration

- A malformed web address, for example a broken `%` code, made the API answer with a server error instead of a 400. Fixed in the shared error handler.
- In production mode the security policy forced browsers onto HTTPS even when the site was served over plain HTTP, so the page went blank on a LAN address. It now does that only when `COOKIE_SECURE=true`, meaning you've set up HTTPS.
- The proxy setting was fixed at "off", so behind a hosting proxy every visitor would share one login rate limit. It is now configurable with `TRUST_PROXY`.
- In dev mode, a frontend folder named `api` clashed with the `/api` proxy and blanked the page. The frontend agent moved the folder, and the proxy now matches only `/api/` and `/uploads/`.

## Decisions made on your behalf

You asked me to go ahead without questions, so these were my calls. Each is easy to change.

- All marketing copy is collected in `src/ui/content/copy.ts`. It describes only what the photos show, with no invented business facts.
- Prices shown on the site are for display. Amazon's price is the real one, and the shirt page says so.
- Colours and sizes are information only. There is no stock tracking, and each shirt has a single Amazon link.
- The size chart measurements are typical values, not your actual garment specs.
- Amazon links must be `https` on amazon.com.au, amazon.com, amzn.to or amzn.asia. Anything else is rejected, so a stolen admin session can't turn the Buy buttons into phishing links.
- Categories are managed on the main admin page, under the shirt list.
- The stack is TypeScript, Express, React and SQLite, running locally.

## Still unconfirmed or deferred

- The contact form, newsletter and customer wishlists were left out, as agreed.
- Hosting, a domain and HTTPS aren't set up. The site runs locally.
- The Amazon links on your 7 shirts are placeholder Amazon searches. A search page can show other sellers' shirts, so swap in your real listing links before launch.
- There's no password reset, and no two-factor login. To change the admin password, edit `.env` and run `npm run seed` again. That doesn't sign out sessions that are already logged in, which last up to 12 hours.

## Known gaps

- The login rate limiter lives in memory, so restarting the server resets it.
- If `npm run seed` crashes partway through loading the sample catalogue, running it again won't fill in the missing shirts, because it only seeds when there are no shirts at all. Delete `data/` and `uploads/` and run it again.
- Google Fonts are loaded from Google, which shares visitors' IP addresses with them. Self-hosting the two fonts would fix that.
- Photos are stored on local disk in `uploads/` and the database in `data/`. Neither is in git, so back them up yourself.

## Before going live

1. Serve the site over HTTPS and set `COOKIE_SECURE=true` in `.env`. The server prints a warning in production until you do.
2. If a reverse proxy sits in front of the app, set `TRUST_PROXY=1`.
3. Use a long, unique admin password.
4. Swap in your real Amazon listing links, prices, sizes and size-chart measurements.
5. Set up backups for `data/` and `uploads/`.

The details are in `docs/security-review.md` and `docs/threat-model.md`.

## Round 4: real range and rebrand (7 October 2026)

The site is now branded 2A Marketing, with "2A Marketing Pty Ltd" in the footer. The placeholder name is gone from every visible page; it survives only in internal names nobody sees, such as the session cookie and the database file name.

Your 7 photos were edited to remove the mannequin heads. On the 5 white-background shots, the head and neck were painted out, so each shirt looks like it's on an invisible mannequin. The 2 photos on dark wood had no head in frame, so they were only cropped. Every photo is now 4:5 to fit the site's image frames. The edited photos are in `catalogue/images/` and your originals are untouched in `catalogue/originals/`.

| Shirt | Category | Colour |
|---|---|---|
| Sydney Harbour Bridge 1938 Tee | Australia | Stone |
| Sydney Harbour Sunset Tee | Australia | Stone |
| Tasmania Tee | Australia | White |
| Vintage Racer No. 81 Tee | Vintage Motors | Stone |
| Vintage Racer No. 07 Tee | Vintage Motors | Cream |
| Essential Black Crew Tee | Essentials | Black |
| Merry Christmas & Happy New Year Tee | Seasonal | Black |

The Sydney Harbour Bridge, Sydney Harbour Sunset and Vintage Racer No. 81 tees are featured on the home page.

`npm run seed` now loads this catalogue into an empty database. It checks the whole file first, and the load either finishes completely or leaves nothing behind, which closes the partial-seed gap from round 1. Your earlier local database, which held only the sample shirts, was moved to `backups/` rather than deleted.

These details weren't in the photos, so I set placeholders. Please check them:

- Prices: $39.95 for printed tees and $29.95 for the plain black crew.
- Sizes: S to XXL on every shirt.
- Amazon links: searches for each shirt, not your actual listings.
- Size chart: typical measurements, not yours.

Two photos (Tasmania and Sydney Harbour Sunset) are much smaller than the others and look slightly soft on large screens. Higher-resolution photos would fix that. A critical advisory published for `shell-quote`, used only by the dev-server runner, was resolved by pinning a patched version. The dependency audit is clean again.

Gates this round: 436 tests passing, typecheck clean, build passing, 0 known vulnerabilities, and the site checked in a browser on your real data.

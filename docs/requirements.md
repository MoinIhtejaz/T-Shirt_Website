# Requirements: Saltline Sydney t-shirt showcase

Working brand name: **Saltline** (placeholder, easy to rename).

## What it is

A showcase site for a Sydney t-shirt label. Visitors browse the catalogue and click through to Amazon to buy. The site itself takes no payments, holds no cart and ships nothing.

## 1. Actors

| Actor | Can do |
|---|---|
| Visitor (anonymous) | Browse the catalogue, filter by category, view a shirt's details, read the About and Size Guide pages, click "Buy on Amazon" |
| Admin (the owner, one account) | Everything a visitor can, plus create, edit, publish/unpublish and delete shirts, upload shirt images, and manage categories |

## 2. Core transaction

A visitor lands on the home page, opens a shirt, sees its photos, price (AUD), colours and sizes, and clicks **Buy on Amazon**. That opens the shirt's Amazon listing in a new tab. If this path breaks, the site has no purpose.

The admin side of the same path: the admin logs in, adds a shirt with images and an Amazon URL, publishes it, and it appears in the public catalogue.

## 3. Data ownership

- Products, product images and categories belong to the admin. Only the admin can write them.
- Visitors can read only **published** products. Drafts are visible only to the admin.
- No visitor data is stored.

## 4. Auth model

Single tenant with one admin role. No customer accounts. The admin logs in with email and password, and the session lives in an HttpOnly cookie. Public pages need no authentication.

## 5. Persistence and scale

- Small catalogue: up to about 200 products, about 10 categories, up to 8 images per product.
- Almost all traffic is reads. Writes come only from the admin, a few times a week.
- SQLite is enough. Images are stored on local disk.

## 6. External dependencies

- **Amazon**: outbound links only, one URL per product. There is no Amazon API integration.
- No payment provider, email service or third-party storage in v1.

## 7. Compliance and data sensitivity

- The only sensitive data is the admin's credentials. The password is hashed and never stored in plain text.
- No customer personal, financial or health data is stored.
- Amazon links must be validated as Amazon domains, so a stolen admin session can't turn the "Buy" buttons into phishing links.

## 8. Definition of done

1. `npm install && npm run dev` starts the site locally.
2. The home page shows featured shirts. The shop page lists all published shirts and filters by category.
3. A product page shows the image gallery, AUD price, colours, sizes and a working "Buy on Amazon" button.
4. About and Size Guide pages exist.
5. The admin logs in at `/admin`, creates a shirt with an uploaded image and an Amazon link, publishes it, and sees it on the public site.
6. Unpublishing a shirt hides it from the public site and its API.
7. Every view has loading, empty and error states, and the layout works on phones.

## Pages

- `/`: hero, featured shirts, a short brand story teaser
- `/shop` and `/shop?category=<slug>`: product grid
- `/shirts/<slug>`: product detail
- `/about`: the Sydney story
- `/size-guide`: size chart (chest and length in cm for XS to XXL)
- `/admin/login`, `/admin`, `/admin/products/new`, `/admin/products/<id>`: admin panel

## Assumptions (not confirmed by you)

These are known risks. Correct any that are wrong.

- **A1. Stack:** TypeScript throughout. Express API, React + Vite frontend, SQLite through Node's built-in `node:sqlite`, all in one repository. Runs locally, and hosting is out of scope for v1.
- **A2. Admin account:** created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` by a seed command. There is no password-reset flow, and the password is changed by re-running the seed.
- **A3. Prices** are shown in AUD for display only. Amazon's price is the real one and may differ.
- **A4. Colours and sizes** are display information only. There is no per-variant stock or per-colour link.
- **A5. Seed data:** 6 sample shirts in 3 categories (Graphic, Essentials, Sydney Icons), with placeholder images and placeholder Amazon URLs.
- **A6. Look:** a clean, editorial "coastal Sydney" style: sand, harbour blue and off-white.
- **A7. Allowed Amazon link hosts:** `amazon.com.au`, `amazon.com`, `amzn.to`, `amzn.asia` and their `www.` forms. HTTPS only.
- **A8. Image uploads:** JPEG, PNG and WebP only, 5 MB maximum, stored under `uploads/` with server-generated filenames.

## Deferred

- Contact form, newsletter, customer wishlists
- Deployment and hosting, a custom domain
- SEO extras beyond page titles and meta descriptions, and analytics

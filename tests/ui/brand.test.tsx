// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import {
  adminProduct,
  apiError,
  categories,
  jsonResponse,
  mockFetch,
  product,
  renderAt,
  session,
  stubBrowserBits,
  summary,
  type FetchCall,
} from './helpers';

beforeEach(() => stubBrowserBits());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
});

/** Answers every public and admin read the pages make, as a logged-in admin. */
function everythingFetch() {
  return mockFetch((call: FetchCall) => {
    const { url } = call;
    if (url === '/api/auth/me') return jsonResponse(session);
    if (url === '/api/categories') return jsonResponse({ items: categories });
    if (url === `/api/products/${product.slug}`) return jsonResponse(product);
    if (url.startsWith('/api/products')) return jsonResponse({ items: [summary] });
    if (url === '/api/admin/products') return jsonResponse({ items: [adminProduct] });
    if (url === `/api/admin/products/${adminProduct.id}`) return jsonResponse(adminProduct);
    return apiError(404, 'NOT_FOUND', 'Not found.');
  });
}

/** Everything a visitor or a crawler can see: body text, attributes, title and head meta. */
function visibleSurface(container: HTMLElement) {
  const attrs = [...container.querySelectorAll('*')].flatMap((el) =>
    [...el.attributes].map((a) => `${a.name}=${a.value}`),
  );
  const meta = [...document.head.querySelectorAll('meta')].map((m) => m.outerHTML);
  return [container.textContent ?? '', attrs.join('\n'), document.title, meta.join('\n')].join('\n');
}

const year = new Date().getFullYear();

describe('2A Marketing brand', () => {
  it('shows the name in the header, the legal name in the footer and the Amazon line', async () => {
    everythingFetch();
    renderAt('/');
    expect(await screen.findByText(summary.name)).toBeInTheDocument();

    expect(screen.getByRole('link', { name: '2A Marketing home' })).toHaveAttribute('href', '/');
    expect(screen.getByText(`© ${year} 2A Marketing Pty Ltd`)).toBeInTheDocument();
    expect(screen.getByText(/our shirts are sold on amazon/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Our harbour,on your back.');
    expect(screen.getByRole('heading', { level: 2, name: 'A few to start with' })).toBeInTheDocument();
    expect(document.title).toBe('2A Marketing');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(
      /^2A Marketing is a Sydney business/,
    );
  });

  it('suffixes page titles with the brand', async () => {
    everythingFetch();
    renderAt('/about');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sydney first, then a few detours' })).toBeInTheDocument();
    expect(document.title).toBe('About · 2A Marketing');
    expect(screen.getByText('2A Marketing, Sydney')).toBeInTheDocument();
  });

  it('names the brand on the admin login and the admin bar', async () => {
    mockFetch(() => apiError(401, 'UNAUTHENTICATED', 'Log in first.'));
    const login = renderAt('/admin/login');
    expect(await screen.findByText('2A Marketing admin')).toBeInTheDocument();
    login.unmount();

    everythingFetch();
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Shirts' })).toBeInTheDocument();
    expect(screen.getByText('2A Marketing admin')).toBeInTheDocument();
  });

  const pages: { path: string; ready: () => Promise<unknown> }[] = [
    { path: '/', ready: () => screen.findByText(summary.name) },
    { path: '/shop', ready: () => screen.findByRole('link', { name: 'Australia' }) },
    { path: `/shirts/${product.slug}`, ready: () => screen.findByRole('link', { name: /buy on amazon/i }) },
    { path: '/about', ready: () => screen.findByRole('heading', { level: 1 }) },
    { path: '/size-guide', ready: () => screen.findByRole('table') },
    { path: '/nope', ready: () => screen.findByRole('heading', { name: 'Nothing at this address.' }) },
    { path: '/admin/login', ready: () => screen.findByRole('heading', { name: 'Log in' }) },
    { path: '/admin', ready: () => screen.findByRole('heading', { name: 'Shirts' }) },
    { path: `/admin/products/${adminProduct.id}`, ready: () => screen.findByLabelText('Name') },
  ];

  it.each(pages)('never shows "Saltline" on $path', async ({ path, ready }) => {
    everythingFetch();
    const { container } = renderAt(path);
    await ready();
    expect(visibleSurface(container)).not.toMatch(/saltline/i);
  });

  it('keeps "Saltline" out of index.html and the favicon', () => {
    // Vitest runs from the project root.
    const html = readFileSync(resolve(process.cwd(), 'src/ui/index.html'), 'utf8');
    const favicon = readFileSync(resolve(process.cwd(), 'src/ui/public/favicon.svg'), 'utf8');
    expect(html).not.toMatch(/saltline/i);
    expect(favicon).not.toMatch(/saltline/i);
    expect(html).toContain('<title>2A Marketing</title>');
  });
});

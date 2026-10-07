// @vitest-environment jsdom
// SEC-004: hostile product text from the API is rendered as text, never as markup,
// on the public product page, the shop grid and the admin list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { AdminProduct, Product } from '../../contracts/types';
import {
  adminProduct,
  apiError,
  jsonResponse,
  mockFetch,
  product,
  renderAt,
  session,
  stubBrowserBits,
  summary,
} from '../ui/helpers';

const SCRIPT = '<script>window.__xss = 1</script>';
const IMG = '<img src=x onerror="window.__xss=2">';
const SVG = '<svg onload="window.__xss=3"></svg>';

const hostile: Product = {
  ...product,
  name: `Tee ${SCRIPT}`,
  description: `${IMG}\n${SVG}\n<a href="javascript:alert(1)">click</a>`,
  colours: [{ name: `Red ${IMG}`, hex: '#FF0000' }],
  category: { slug: 'graphic', name: `Cat ${SVG}` },
  images: [
    { id: 1, url: '/uploads/a.png', alt: `Alt ${IMG}`, sortOrder: 0 },
    { id: 2, url: '/uploads/b.png', alt: `Alt2 ${SCRIPT}`, sortOrder: 1 },
  ],
};

function expectNoInjectedMarkup(root: ParentNode) {
  expect(root.querySelectorAll('script').length).toBe(0);
  expect(root.querySelectorAll('[onerror], [onload], [onclick]').length).toBe(0);
  expect(root.querySelectorAll('img[src="x"]').length).toBe(0);
  expect(root.querySelectorAll('a[href^="javascript:"]').length).toBe(0);
  expect(root.querySelectorAll('svg[onload]').length).toBe(0);
  expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
}

beforeEach(() => stubBrowserBits());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as { __xss?: number }).__xss;
});

describe('SEC-004 rendering of hostile catalogue text', () => {
  it('product page: name, description, colour, category and alt text are plain text', async () => {
    mockFetch(({ url }) => (url.startsWith('/api/products/') ? jsonResponse(hostile) : apiError(404, 'NOT_FOUND', 'Not found.')));
    const { container } = renderAt('/shirts/harbour-ferry-tee');

    expect(await screen.findByRole('heading', { level: 1, name: `Tee ${SCRIPT}` })).toBeInTheDocument();
    expect(screen.getByText(IMG)).toBeInTheDocument();
    expect(screen.getByText(SVG)).toBeInTheDocument();
    expect(screen.getByText(`Red ${IMG}`)).toBeInTheDocument();
    expect(screen.getAllByText(`Cat ${SVG}`).length).toBeGreaterThan(0);
    // Alt text lands in the alt attribute, where it is inert.
    expect(container.querySelector('img.gallery__main, .gallery__main img')?.getAttribute('alt')).toBe(`Alt ${IMG}`);
    expectNoInjectedMarkup(document);
    // The document title is set through document.title, so it is text as well.
    expect(document.title).toContain(SCRIPT);
    expect(document.head.querySelectorAll('script').length).toBe(0);
  });

  it('product page: the Buy link carries rel="noopener noreferrer sponsored" and opens in a new tab', async () => {
    mockFetch(() => jsonResponse(hostile));
    renderAt('/shirts/harbour-ferry-tee');
    const buy = await screen.findByRole('link', { name: /buy on amazon/i });
    expect(buy.getAttribute('rel')?.split(' ').sort()).toEqual(['noopener', 'noreferrer', 'sponsored']);
    expect(buy).toHaveAttribute('target', '_blank');
    expect(buy).toHaveAttribute('href', product.amazonUrl);
  });

  it('shop grid: hostile names in cards and category chips are plain text', async () => {
    mockFetch(({ url }) => {
      if (url === '/api/categories') return jsonResponse({ items: [{ id: 1, slug: 'graphic', name: `Chip ${SCRIPT}`, sortOrder: 0 }] });
      if (url.startsWith('/api/products')) {
        return jsonResponse({
          items: [{ ...summary, name: `Card ${SCRIPT}`, primaryImage: { id: 1, url: '/uploads/a.png', alt: `Alt ${IMG}`, sortOrder: 0 } }],
        });
      }
      return apiError(404, 'NOT_FOUND', 'Not found.');
    });
    renderAt(`/shop?category=${encodeURIComponent(SCRIPT)}`);
    expect(await screen.findByText(`Card ${SCRIPT}`)).toBeInTheDocument();
    expect(await screen.findByText(`Chip ${SCRIPT}`)).toBeInTheDocument();
    expectNoInjectedMarkup(document);
  });

  it('admin list: hostile product names are plain text', async () => {
    const evil: AdminProduct = { ...adminProduct, name: `Admin ${SCRIPT}`, category: { slug: 'graphic', name: `Cat ${IMG}` } };
    mockFetch(({ url }) => {
      if (url === '/api/auth/me') return jsonResponse(session);
      if (url === '/api/admin/products') return jsonResponse({ items: [evil] });
      if (url === '/api/categories') return jsonResponse({ items: [] });
      return apiError(404, 'NOT_FOUND', 'Not found.');
    });
    renderAt('/admin');
    expect(await screen.findByText(`Admin ${SCRIPT}`)).toBeInTheDocument();
    expectNoInjectedMarkup(document);
  });
});

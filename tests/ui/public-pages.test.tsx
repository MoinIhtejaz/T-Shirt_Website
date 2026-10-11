// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError, categories, jsonResponse, mockFetch, product, renderAt, stubBrowserBits, summary } from './helpers';

beforeEach(() => stubBrowserBits());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('product page', () => {
  it('renders a Buy on Amazon link that opens the listing safely in a new tab', async () => {
    mockFetch(({ url }) => (url === '/api/products/sydney-harbour-sunset-tee' ? jsonResponse(product) : apiError(404, 'NOT_FOUND', 'Not found.')));
    renderAt('/shirts/sydney-harbour-sunset-tee');

    const buy = await screen.findByRole('link', { name: /buy on amazon/i });
    expect(buy).toHaveAttribute('href', 'https://www.amazon.com.au/dp/B000TEST01');
    expect(buy).toHaveAttribute('target', '_blank');
    expect(buy).toHaveAttribute('rel', 'noopener noreferrer sponsored');

    expect(screen.getByRole('heading', { level: 1, name: 'Sydney Harbour Sunset Tee' })).toBeInTheDocument();
    expect(screen.getByText('$49.95')).toBeInTheDocument();
    expect(screen.getByText('Stone')).toBeInTheDocument();
    expect(screen.getByText(/confirmed on amazon/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check the size guide' })).toHaveAttribute('href', '/size-guide');
  });

  it('renders the description as plain-text paragraphs, never as HTML', async () => {
    mockFetch(() => jsonResponse({ ...product, description: '<b>Bold claim</b>\nSecond line' }));
    const { container } = renderAt('/shirts/sydney-harbour-sunset-tee');
    expect(await screen.findByText('<b>Bold claim</b>')).toBeInTheDocument();
    expect(screen.getByText('Second line').tagName).toBe('P');
    expect(container.querySelector('.product__desc b')).toBeNull();
  });

  it('switches the main photo from the thumbnails', async () => {
    mockFetch(() => jsonResponse(product));
    renderAt('/shirts/sydney-harbour-sunset-tee');
    const second = await screen.findByRole('button', { name: 'Show photo 2 of 2' });
    await userEvent.click(second);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Back of the shirt' })).toBeInTheDocument();
  });

  it('shows the not-found page when the API returns 404', async () => {
    mockFetch(() => apiError(404, 'NOT_FOUND', 'Not found.'));
    renderAt('/shirts/missing');
    expect(await screen.findByRole('heading', { name: "This shirt isn't here." })).toBeInTheDocument();
  });
});

describe('shop page', () => {
  function shopFetch(products: () => Response) {
    return mockFetch(({ url }) => {
      if (url === '/api/categories') return jsonResponse({ items: categories });
      if (url.startsWith('/api/products')) return products();
      return apiError(404, 'NOT_FOUND', 'Not found.');
    });
  }

  it('shows an empty state when there are no shirts', async () => {
    shopFetch(() => jsonResponse({ items: [] }));
    renderAt('/shop');
    expect(await screen.findByText('No shirts here yet.')).toBeInTheDocument();
  });

  it('shows a category-specific empty state with a way back to all shirts', async () => {
    const { calls } = shopFetch(() => jsonResponse({ items: [] }));
    renderAt('/shop?category=essentials');
    expect(await screen.findByText('No shirts in this category yet.')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/products?category=essentials')).toBe(true);
  });

  it('shows an error with a retry that loads the shirts', async () => {
    let attempts = 0;
    shopFetch(() => {
      attempts += 1;
      return attempts === 1 ? apiError(500, 'INTERNAL', 'Something went wrong.') : jsonResponse({ items: [summary] });
    });
    renderAt('/shop');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText("The shirts didn't load.")).toBeInTheDocument();
    expect(within(alert).getByText('Something went wrong.')).toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Sydney Harbour Sunset Tee')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('filters by category through the URL', async () => {
    const { calls } = shopFetch(() => jsonResponse({ items: [summary] }));
    renderAt('/shop');
    const chip = await screen.findByRole('link', { name: 'Australia' });
    await userEvent.click(chip);
    expect(await screen.findByRole('link', { name: 'Australia', current: 'page' })).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/api/products?category=australia')).toBe(true);
  });
});

describe('home page', () => {
  it('loads featured shirts only', async () => {
    const { calls } = mockFetch(() => jsonResponse({ items: [summary] }));
    renderAt('/');
    expect(await screen.findByText('Sydney Harbour Sunset Tee')).toBeInTheDocument();
    expect(calls[0].url).toBe('/api/products?featured=true');
    expect(screen.getByRole('link', { name: /read our story/i })).toHaveAttribute('href', '/about');
  });
});

describe('static pages', () => {
  it('renders the size guide table from S to XXL', () => {
    mockFetch(() => jsonResponse({}));
    renderAt('/size-guide');
    const table = screen.getByRole('table');
    const rowHeaders = within(table).getAllByRole('rowheader').map((th) => th.textContent);
    expect(rowHeaders).toEqual(['S', 'M', 'L', 'XL', 'XXL']);
  });

  it('renders a 404 for unknown routes', () => {
    mockFetch(() => jsonResponse({}));
    renderAt('/nope/never');
    expect(screen.getByRole('heading', { name: 'Nothing at this address.' })).toBeInTheDocument();
  });
});

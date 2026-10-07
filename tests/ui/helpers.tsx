import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { AdminProduct, Category, Product, ProductSummary } from '../../contracts/types';
import { AppRoutes } from '../../src/ui/App';

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function apiError(status: number, code: string, message: string, details?: { field: string; message: string }[]) {
  return jsonResponse({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

export interface FetchCall {
  url: string;
  method: string;
  headers: Headers;
  body: BodyInit | null | undefined;
}

type Handler = (call: FetchCall) => Response | Promise<Response>;

/** Replaces global fetch. The handler gets a normalised call; every call is recorded. */
export function mockFetch(handler: Handler) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: FetchCall = {
      url: String(input),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: new Headers(init.headers),
      body: init.body,
    };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function renderAt(path: string, state?: unknown) {
  const [pathname, search = ''] = path.split('?');
  return render(
    <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : '', state }]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

export function stubBrowserBits() {
  vi.stubGlobal('scrollTo', vi.fn());
  if (!('createObjectURL' in URL)) {
    Object.assign(URL, { createObjectURL: () => '', revokeObjectURL: () => undefined });
  }
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
}

export const categories: Category[] = [
  { id: 1, slug: 'australia', name: 'Australia', sortOrder: 0 },
  { id: 2, slug: 'vintage-motors', name: 'Vintage Motors', sortOrder: 1 },
];

export const summary: ProductSummary = {
  id: 7,
  slug: 'sydney-harbour-sunset-tee',
  name: 'Sydney Harbour Sunset Tee',
  priceCents: 4995,
  currency: 'AUD',
  category: { slug: 'australia', name: 'Australia' },
  primaryImage: { id: 1, url: '/uploads/a.svg', alt: 'Stone t-shirt with a sunset photo of the Sydney Opera House and Harbour Bridge', sortOrder: 0 },
  colours: [{ name: 'Stone', hex: '#D9D5C3' }],
  featured: true,
};

export const product: Product = {
  ...summary,
  description: 'A photo print of the Opera House and the Harbour Bridge at sunset.\nStone crew neck tee.',
  sizes: ['S', 'M', 'L'],
  images: [
    { id: 1, url: '/uploads/a.svg', alt: 'Front of the shirt', sortOrder: 0 },
    { id: 2, url: '/uploads/b.svg', alt: 'Back of the shirt', sortOrder: 1 },
  ],
  amazonUrl: 'https://www.amazon.com.au/dp/B000TEST01',
};

export const adminProduct: AdminProduct = {
  ...product,
  categoryId: 1,
  status: 'published',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

export const session = { user: { id: 1, email: 'owner@example.com' } };

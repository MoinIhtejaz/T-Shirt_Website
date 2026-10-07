// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  adminProduct,
  apiError,
  categories,
  jsonResponse,
  mockFetch,
  renderAt,
  session,
  stubBrowserBits,
  type FetchCall,
} from './helpers';

beforeEach(() => stubBrowserBits());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
});

/** Routes for a logged-in admin; `extra` can override any call. */
function adminFetch(extra?: (call: FetchCall) => Response | undefined) {
  return mockFetch((call) => {
    const override = extra?.(call);
    if (override) return override;
    if (call.url === '/api/auth/me') return jsonResponse(session);
    if (call.url === '/api/categories') return jsonResponse({ items: categories });
    if (call.url === '/api/admin/products' && call.method === 'GET') return jsonResponse({ items: [adminProduct] });
    if (call.url === `/api/admin/products/${adminProduct.id}` && call.method === 'GET') return jsonResponse(adminProduct);
    return apiError(404, 'NOT_FOUND', 'Not found.');
  });
}

describe('admin route guard', () => {
  it('redirects to the login page when /api/auth/me returns 401', async () => {
    const { calls } = mockFetch(() => apiError(401, 'UNAUTHENTICATED', 'Log in first.'));
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(calls[0].url).toBe('/api/auth/me');
    expect(screen.queryByRole('heading', { name: 'Shirts' })).not.toBeInTheDocument();
  });

  it('also guards nested admin routes', async () => {
    mockFetch(() => apiError(401, 'UNAUTHENTICATED', 'Log in first.'));
    renderAt('/admin/products/new');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('shows the product table with status badges when logged in, and marks the page noindex', async () => {
    adminFetch();
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Shirts' })).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Published')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: /view sydney harbour sunset tee/i })).toHaveAttribute(
      'href',
      '/shirts/sydney-harbour-sunset-tee',
    );
    expect(document.head.querySelector('meta[name="robots"][content="noindex"]')).not.toBeNull();
  });

  it('asks for confirmation before deleting a shirt', async () => {
    const { calls } = adminFetch((c) => (c.method === 'DELETE' ? jsonResponse(null, 204) : undefined));
    renderAt('/admin');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Sydney Harbour Sunset Tee' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(screen.getByText('Deleted "Sydney Harbour Sunset Tee".')).toBeInTheDocument());
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe('/api/admin/products/7');
    expect(del?.headers.get('X-Saltline-CSRF')).toBe('1');
  });
});

describe('admin login', () => {
  it('shows INVALID_CREDENTIALS inline and disables submit while pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockFetch(async (call) => {
      if (call.url === '/api/auth/login') {
        await gate;
        return apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      return apiError(401, 'UNAUTHENTICATED', 'Log in first.');
    });
    renderAt('/admin/login');

    await userEvent.type(screen.getByLabelText('Email'), 'owner@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByRole('button', { name: /logging in/i })).toBeDisabled();
    release();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
  });

  it('shows the server message when rate limited', async () => {
    mockFetch(() => apiError(429, 'RATE_LIMITED', 'Too many login attempts. Try again in 10 minutes.'));
    renderAt('/admin/login');
    await userEvent.type(screen.getByLabelText('Email'), 'owner@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many login attempts. Try again in 10 minutes.');
  });

  it('goes to the admin after a successful login', async () => {
    mockFetch((call) => {
      if (call.url === '/api/auth/login') return jsonResponse(session);
      if (call.url === '/api/auth/me') return jsonResponse(session);
      if (call.url === '/api/categories') return jsonResponse({ items: categories });
      return jsonResponse({ items: [] });
    });
    renderAt('/admin/login');
    await userEvent.type(screen.getByLabelText('Email'), 'owner@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'right-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Shirts' })).toBeInTheDocument();
    expect(await screen.findByText('No shirts yet.')).toBeInTheDocument();
  });
});

describe('product editor', () => {
  async function fillRequired() {
    await userEvent.type(await screen.findByLabelText('Name'), 'Vintage Racer No. 81 Tee');
    await userEvent.type(screen.getByLabelText('Price (AUD)'), '49.95');
    await userEvent.type(screen.getByLabelText('Amazon link'), 'https://www.amazon.com.au/dp/B0TEST');
    await userEvent.type(screen.getByLabelText('Colour 1 name'), 'Stone');
  }

  it('shows VALIDATION_FAILED details next to the matching inputs', async () => {
    const { calls } = adminFetch((c) =>
      c.method === 'POST' && c.url === '/api/admin/products'
        ? apiError(400, 'VALIDATION_FAILED', 'Some fields need fixing.', [
            { field: 'amazonUrl', message: 'Must be an https link to Amazon.' },
            { field: 'colours.0.hex', message: 'Use a hex colour like #1F4E6B.' },
          ])
        : undefined,
    );
    renderAt('/admin/products/new');
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Create shirt' }));

    const amazon = screen.getByLabelText('Amazon link');
    await waitFor(() => expect(amazon).toHaveAttribute('aria-invalid', 'true'));
    expect(amazon).toHaveAccessibleDescription(expect.stringContaining('Must be an https link to Amazon.'));

    const hex = screen.getByLabelText('Hex');
    expect(hex).toHaveAttribute('aria-invalid', 'true');
    expect(hex).toHaveAccessibleDescription('Use a hex colour like #1F4E6B.');
    expect(screen.getByRole('alert')).toHaveTextContent('Some fields need fixing.');

    const post = calls.find((c) => c.method === 'POST');
    const body = JSON.parse(String(post?.body));
    expect(body).toMatchObject({
      name: 'Vintage Racer No. 81 Tee',
      priceCents: 4995,
      amazonUrl: 'https://www.amazon.com.au/dp/B0TEST',
      sizes: ['S', 'M', 'L', 'XL'],
      status: 'draft',
      featured: false,
      categoryId: null,
      colours: [{ name: 'Stone', hex: '#1F4E6B' }],
    });
    expect(post?.headers.get('X-Saltline-CSRF')).toBe('1');
  });

  it('shows SLUG_TAKEN on the slug field', async () => {
    adminFetch((c) =>
      c.method === 'POST' && c.url === '/api/admin/products'
        ? apiError(409, 'SLUG_TAKEN', 'That slug is already in use.', [
            { field: 'slug', message: 'Another shirt already uses this address.' },
          ])
        : undefined,
    );
    renderAt('/admin/products/new');
    await fillRequired();
    await userEvent.type(screen.getByLabelText('Web address'), 'sydney-harbour-sunset-tee');
    await userEvent.click(screen.getByRole('button', { name: 'Create shirt' }));
    const slug = screen.getByLabelText('Web address');
    await waitFor(() => expect(slug).toHaveAttribute('aria-invalid', 'true'));
    expect(slug).toHaveAccessibleDescription(expect.stringContaining('Another shirt already uses this address.'));
  });

  it('catches a bad price before sending anything', async () => {
    const { calls } = adminFetch();
    renderAt('/admin/products/new');
    await userEvent.type(await screen.findByLabelText('Name'), 'Tee');
    await userEvent.type(screen.getByLabelText('Price (AUD)'), '49.999');
    await userEvent.click(screen.getByRole('button', { name: 'Create shirt' }));
    expect(screen.getByLabelText('Price (AUD)')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('loads an existing shirt with the price in dollars and saves with PUT', async () => {
    const { calls } = adminFetch((c) =>
      c.method === 'PUT' ? jsonResponse({ ...adminProduct, priceCents: 5500 }) : undefined,
    );
    renderAt('/admin/products/7');
    const price = await screen.findByLabelText('Price (AUD)');
    expect(price).toHaveValue('49.95');
    await userEvent.clear(price);
    await userEvent.type(price, '55');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/changes saved/i)).toBeInTheDocument();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/admin/products/7');
    expect(JSON.parse(String(put?.body)).priceCents).toBe(5500);
  });

  it('sends the admin to login if the session expires while saving', async () => {
    adminFetch((c) => (c.method === 'PUT' ? apiError(401, 'UNAUTHENTICATED', 'Log in first.') : undefined));
    renderAt('/admin/products/7');
    await screen.findByLabelText('Price (AUD)');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByText(/your session ended/i)).toBeInTheDocument();
  });
});

describe('image manager', () => {
  it('rejects an oversized file before uploading', async () => {
    const { calls } = adminFetch();
    renderAt('/admin/products/7');
    const input = await screen.findByLabelText('Photo file');
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, big);
    expect(await screen.findByText(/the limit is 5 mb/i)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/images') && c.method === 'POST')).toBe(false);
  });

  it('uploads a photo with alt text and shows server errors such as 415', async () => {
    let uploads = 0;
    const { calls } = adminFetch((c) => {
      if (c.method === 'POST' && c.url === '/api/admin/products/7/images') {
        uploads += 1;
        return uploads === 1
          ? apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'That file is not a JPEG, PNG or WebP image.')
          : jsonResponse({ id: 9, url: '/uploads/new.png', alt: 'Folded on the sand', sortOrder: 2 }, 201);
      }
      return undefined;
    });
    renderAt('/admin/products/7');
    const input = await screen.findByLabelText('Photo file');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shirt.png', { type: 'image/png' });
    await userEvent.upload(input, file);
    expect(screen.getByRole('img', { name: 'Preview of the selected photo' })).toHaveAttribute('src', 'blob:preview');

    await userEvent.type(screen.getByLabelText('Alt text for the new photo'), 'Folded on the sand');
    await userEvent.click(screen.getByRole('button', { name: 'Upload photo' }));
    expect(await screen.findByText('That file is not a JPEG, PNG or WebP image.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Upload photo' }));
    expect(await screen.findByText('Photo uploaded.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('image-row'))).toHaveLength(3);

    const post = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/images')).at(-1);
    const form = post?.body as FormData;
    expect(form.get('image')).toBeInstanceOf(File);
    expect(form.get('alt')).toBe('Folded on the sand');
  });

  it('reorders photos by patching sortOrder', async () => {
    const { calls } = adminFetch((c) => {
      if (c.method === 'PATCH') {
        const id = Number(c.url.split('/').at(-1));
        const { sortOrder } = JSON.parse(String(c.body));
        const img = adminProduct.images.find((i) => i.id === id)!;
        return jsonResponse({ ...img, sortOrder });
      }
      return undefined;
    });
    renderAt('/admin/products/7');
    await userEvent.click(await screen.findByRole('button', { name: 'Move photo 2 up' }));
    expect(await screen.findByText('Moved photo 2 to position 1.')).toBeInTheDocument();
    const patches = calls.filter((c) => c.method === 'PATCH').map((c) => [c.url, JSON.parse(String(c.body))]);
    expect(patches).toEqual(
      expect.arrayContaining([
        ['/api/admin/products/7/images/2', { sortOrder: 0 }],
        ['/api/admin/products/7/images/1', { sortOrder: 1 }],
      ]),
    );
  });
});

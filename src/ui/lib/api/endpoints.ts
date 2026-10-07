import { apiRequest } from './client';
import type {
  AdminProduct,
  Category,
  CategoryInput,
  ImageUpdate,
  ListResponse,
  LoginRequest,
  Product,
  ProductImage,
  ProductInput,
  ProductSummary,
  SessionResponse,
} from '../../../../contracts/types';

type Opts = { signal?: AbortSignal };

const seg = (value: string | number) => encodeURIComponent(String(value));

/** Public catalogue. */
export const publicApi = {
  listCategories: (o: Opts = {}) => apiRequest<ListResponse<Category>>('GET', '/api/categories', o),

  listProducts: (query: { category?: string | null; featured?: boolean } = {}, o: Opts = {}) => {
    const params = new URLSearchParams();
    if (query.category) params.set('category', query.category);
    if (query.featured) params.set('featured', 'true');
    const qs = params.toString();
    return apiRequest<ListResponse<ProductSummary>>('GET', `/api/products${qs ? `?${qs}` : ''}`, o);
  },

  getProduct: (slug: string, o: Opts = {}) => apiRequest<Product>('GET', `/api/products/${seg(slug)}`, o),
};

/** Session routes. See contracts/auth.md. */
export const authApi = {
  login: (body: LoginRequest, o: Opts = {}) => apiRequest<SessionResponse>('POST', '/api/auth/login', { ...o, body }),
  logout: (o: Opts = {}) => apiRequest<void>('POST', '/api/auth/logout', o),
  me: (o: Opts = {}) => apiRequest<SessionResponse>('GET', '/api/auth/me', o),
};

/** Admin-only routes. Every call needs a session cookie. */
export const adminApi = {
  listProducts: (o: Opts = {}) => apiRequest<ListResponse<AdminProduct>>('GET', '/api/admin/products', o),
  getProduct: (id: number, o: Opts = {}) => apiRequest<AdminProduct>('GET', `/api/admin/products/${seg(id)}`, o),
  createProduct: (body: ProductInput, o: Opts = {}) =>
    apiRequest<AdminProduct>('POST', '/api/admin/products', { ...o, body }),
  updateProduct: (id: number, body: ProductInput, o: Opts = {}) =>
    apiRequest<AdminProduct>('PUT', `/api/admin/products/${seg(id)}`, { ...o, body }),
  deleteProduct: (id: number, o: Opts = {}) => apiRequest<void>('DELETE', `/api/admin/products/${seg(id)}`, o),

  uploadImage: (productId: number, file: File, alt: string, o: Opts = {}) => {
    const formData = new FormData();
    formData.append('image', file);
    if (alt.trim() !== '') formData.append('alt', alt.trim());
    return apiRequest<ProductImage>('POST', `/api/admin/products/${seg(productId)}/images`, { ...o, formData });
  },
  updateImage: (productId: number, imageId: number, body: ImageUpdate, o: Opts = {}) =>
    apiRequest<ProductImage>('PATCH', `/api/admin/products/${seg(productId)}/images/${seg(imageId)}`, {
      ...o,
      body,
    }),
  deleteImage: (productId: number, imageId: number, o: Opts = {}) =>
    apiRequest<void>('DELETE', `/api/admin/products/${seg(productId)}/images/${seg(imageId)}`, o),

  createCategory: (body: CategoryInput, o: Opts = {}) =>
    apiRequest<Category>('POST', '/api/admin/categories', { ...o, body }),
  updateCategory: (id: number, body: CategoryInput, o: Opts = {}) =>
    apiRequest<Category>('PUT', `/api/admin/categories/${seg(id)}`, { ...o, body }),
  deleteCategory: (id: number, o: Opts = {}) => apiRequest<void>('DELETE', `/api/admin/categories/${seg(id)}`, o),
};

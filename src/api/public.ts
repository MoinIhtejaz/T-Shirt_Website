// BE-001: public catalogue routes. Published products only.
import { Router } from 'express';
import type { HealthResponse, ListResponse, Category, Product, ProductSummary } from '../../contracts/types';
import type { CategoryService } from '../services/categories';
import type { ProductService } from '../services/products';

export function publicRouter(products: ProductService, categories: CategoryService): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok' };
    res.json(body);
  });

  router.get('/categories', (_req, res) => {
    const body: ListResponse<Category> = { items: categories.list() };
    res.json(body);
  });

  router.get('/products', (req, res) => {
    const { category, featured } = req.query;
    const body: ListResponse<ProductSummary> = {
      items: products.listPublic({
        category: typeof category === 'string' ? category : undefined,
        featured: featured === 'true',
      }),
    };
    res.json(body);
  });

  router.get('/products/:slug', (req, res) => {
    const body: Product = products.getPublic(req.params.slug);
    res.json(body);
  });

  return router;
}

// BE-002: admin product CRUD. Mounted behind requireAdmin.
import { Router } from 'express';
import type { AdminProduct, ListResponse } from '../../contracts/types';
import type { ProductService } from '../services/products';
import { idParam } from './params';

export function adminProductsRouter(products: ProductService): Router {
  const router = Router();

  router.get('/products', (_req, res) => {
    const body: ListResponse<AdminProduct> = { items: products.listAdmin() };
    res.json(body);
  });

  router.post('/products', (req, res) => {
    res.status(201).json(products.create(req.body));
  });

  router.get('/products/:id', (req, res) => {
    res.json(products.getAdmin(idParam(req, 'id')));
  });

  router.put('/products/:id', (req, res) => {
    const id = idParam(req, 'id');
    res.json(products.update(id, req.body));
  });

  router.delete('/products/:id', async (req, res) => {
    await products.remove(idParam(req, 'id'));
    res.status(204).end();
  });

  return router;
}

// BE-004: admin category routes. Mounted behind requireAdmin.
import { Router } from 'express';
import type { CategoryService } from '../services/categories';
import { idParam } from './params';

export function adminCategoriesRouter(categories: CategoryService): Router {
  const router = Router();

  router.post('/categories', (req, res) => {
    res.status(201).json(categories.create(req.body));
  });

  router.put('/categories/:id', (req, res) => {
    const id = idParam(req, 'id');
    res.json(categories.update(id, req.body));
  });

  router.delete('/categories/:id', (req, res) => {
    categories.remove(idParam(req, 'id'));
    res.status(204).end();
  });

  return router;
}

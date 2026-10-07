// BACKEND layer entry point. Exports exactly ApiModule from contracts/modules.ts.
// Mounted at /api after /api/auth; the glue adds the /api 404 after this router.
import { Router, type RequestHandler } from 'express';
import type { ApiDeps, ApiModule } from '../../contracts/modules';
import { createCategoryService } from '../services/categories';
import { createImageService } from '../services/images';
import { createProductService } from '../services/products';
import { adminCategoriesRouter } from './adminCategories';
import { adminImagesRouter } from './adminImages';
import { adminProductsRouter } from './adminProducts';
import { publicRouter } from './public';

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

export const createApiRouter: ApiModule['createApiRouter'] = (deps: ApiDeps) => {
  const products = createProductService(deps);
  const categories = createCategoryService(deps);
  const images = createImageService(deps);

  const admin = Router();
  admin.use(adminProductsRouter(products));
  admin.use(adminImagesRouter(images));
  admin.use(adminCategoriesRouter(categories));

  const router = Router();
  router.use(publicRouter(products, categories));
  router.use('/admin', noStore, deps.requireAdmin, admin);
  return router;
};

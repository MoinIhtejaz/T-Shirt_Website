// Product use cases: public catalogue reads and admin CRUD.
import { UniqueViolationError, type ApiDeps, type ProductQuery, type ProductWrite } from '../../contracts/modules';
import type { AdminProduct, Product, ProductSummary } from '../../contracts/types';
import { HttpError } from '../shared/http';
import { toAdminProduct, toProduct, toProductSummary } from './dto';
import { removeImageFile } from './files';
import { slugTaken, slugify, uniqueSlug } from './slug';
import { parseOrThrow, productInputSchema, validationError, type ProductInputData } from './validation';

type ServiceDeps = Pick<ApiDeps, 'repos' | 'isAllowedAmazonUrl' | 'config'>;

export interface PublicProductFilters {
  category?: string;
  featured?: boolean;
}

export function productNotFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', 'Product not found.');
}

export function createProductService({ repos, isAllowedAmazonUrl, config }: ServiceDeps) {
  const inputSchema = productInputSchema(isAllowedAmazonUrl);

  function validate(body: unknown): ProductInputData {
    const data = parseOrThrow(inputSchema, body);
    if (data.categoryId !== null && !repos.categories.getById(data.categoryId)) {
      throw validationError([{ field: 'categoryId', message: "That category doesn't exist." }]);
    }
    return data;
  }

  function toWrite(data: ProductInputData, slug: string): ProductWrite {
    return {
      slug,
      name: data.name,
      description: data.description,
      priceCents: data.priceCents,
      categoryId: data.categoryId,
      colours: data.colours,
      sizes: data.sizes,
      amazonUrl: data.amazonUrl,
      featured: data.featured,
      status: data.status,
    };
  }

  /** Runs a repository write, turning a slug UNIQUE failure (race fallback) into 409. */
  function guardSlug<T>(write: () => T): T {
    try {
      return write();
    } catch (err) {
      if (err instanceof UniqueViolationError && err.field === 'slug') throw slugTaken();
      throw err;
    }
  }

  function getAdminOrThrow(id: number): AdminProduct {
    const product = repos.products.getById(id);
    if (!product) throw productNotFound();
    return product;
  }

  return {
    listPublic(filters: PublicProductFilters): ProductSummary[] {
      const query: ProductQuery = { status: 'published' };
      if (filters.category !== undefined) query.categorySlug = filters.category;
      if (filters.featured) query.featured = true;
      return repos.products.list(query).map(toProductSummary);
    },

    getPublic(slug: string): Product {
      const product = repos.products.getBySlug(slug);
      if (!product || product.status !== 'published') throw productNotFound();
      return toProduct(product);
    },

    listAdmin(): AdminProduct[] {
      return repos.products.list({}).map(toAdminProduct);
    },

    getAdmin(id: number): AdminProduct {
      return toAdminProduct(getAdminOrThrow(id));
    },

    create(body: unknown): AdminProduct {
      const data = validate(body);
      let slug: string;
      if (data.slug) {
        if (repos.products.getBySlug(data.slug)) throw slugTaken();
        slug = data.slug;
      } else {
        slug = uniqueSlug(slugify(data.name, 'shirt'), (s) => repos.products.getBySlug(s) !== null);
      }
      return toAdminProduct(guardSlug(() => repos.products.create(toWrite(data, slug))));
    },

    update(id: number, body: unknown): AdminProduct {
      const existing = getAdminOrThrow(id);
      const data = validate(body);
      let slug = existing.slug;
      if (data.slug && data.slug !== existing.slug) {
        const owner = repos.products.getBySlug(data.slug);
        if (owner && owner.id !== id) throw slugTaken();
        slug = data.slug;
      }
      const updated = guardSlug(() => repos.products.update(id, toWrite(data, slug)));
      if (!updated) throw productNotFound();
      return toAdminProduct(updated);
    },

    /** Removes the image files first (missing files are fine), then the row; image rows cascade. */
    async remove(id: number): Promise<void> {
      getAdminOrThrow(id);
      for (const image of repos.images.listForProduct(id)) {
        await removeImageFile(config.uploadDir, image.filename);
      }
      if (!repos.products.delete(id)) throw productNotFound();
    },
  };
}

export type ProductService = ReturnType<typeof createProductService>;

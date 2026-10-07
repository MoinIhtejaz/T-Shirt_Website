// Response shapes, built field by field so nothing extra (status, categoryId,
// timestamps, filenames, productId) can leak from a repository object.
import type {
  AdminProduct,
  Category,
  CategoryRef,
  Colour,
  Product,
  ProductImage,
  ProductSummary,
} from '../../contracts/types';

export function toImage(img: ProductImage): ProductImage {
  return { id: img.id, url: img.url, alt: img.alt, sortOrder: img.sortOrder };
}

function toCategoryRef(ref: CategoryRef | null): CategoryRef | null {
  return ref ? { slug: ref.slug, name: ref.name } : null;
}

function toColours(colours: Colour[]): Colour[] {
  return colours.map((c) => ({ name: c.name, hex: c.hex }));
}

export function toCategory(c: Category): Category {
  return { id: c.id, slug: c.slug, name: c.name, sortOrder: c.sortOrder };
}

export function toProductSummary(p: AdminProduct): ProductSummary {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    priceCents: p.priceCents,
    currency: 'AUD',
    category: toCategoryRef(p.category),
    primaryImage: p.primaryImage ? toImage(p.primaryImage) : null,
    colours: toColours(p.colours),
    featured: p.featured,
  };
}

export function toProduct(p: AdminProduct): Product {
  return {
    ...toProductSummary(p),
    description: p.description,
    sizes: [...p.sizes],
    images: p.images.map(toImage),
    amazonUrl: p.amazonUrl,
  };
}

export function toAdminProduct(p: AdminProduct): AdminProduct {
  return {
    ...toProduct(p),
    categoryId: p.categoryId,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

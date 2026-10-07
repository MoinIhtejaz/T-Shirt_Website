// Category use cases: public list and admin create, update, delete.
import { UniqueViolationError, type ApiDeps, type CategoryWrite } from '../../contracts/modules';
import type { Category } from '../../contracts/types';
import { HttpError } from '../shared/http';
import { toCategory } from './dto';
import { slugTaken, slugify, uniqueSlug } from './slug';
import { categoryInputSchema, parseOrThrow } from './validation';

function categoryNotFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', 'Category not found.');
}

export function createCategoryService({ repos }: Pick<ApiDeps, 'repos'>) {
  function guardSlug<T>(write: () => T): T {
    try {
      return write();
    } catch (err) {
      if (err instanceof UniqueViolationError && err.field === 'slug') throw slugTaken();
      throw err;
    }
  }

  return {
    list(): Category[] {
      return repos.categories.list().map(toCategory);
    },

    create(body: unknown): Category {
      const data = parseOrThrow(categoryInputSchema, body);
      let slug: string;
      if (data.slug) {
        if (repos.categories.getBySlug(data.slug)) throw slugTaken();
        slug = data.slug;
      } else {
        slug = uniqueSlug(slugify(data.name, 'category'), (s) => repos.categories.getBySlug(s) !== null);
      }
      const write: CategoryWrite = { slug, name: data.name, sortOrder: data.sortOrder };
      return toCategory(guardSlug(() => repos.categories.create(write)));
    },

    update(id: number, body: unknown): Category {
      const existing = repos.categories.getById(id);
      if (!existing) throw categoryNotFound();
      const data = parseOrThrow(categoryInputSchema, body);
      let slug = existing.slug;
      if (data.slug && data.slug !== existing.slug) {
        const owner = repos.categories.getBySlug(data.slug);
        if (owner && owner.id !== id) throw slugTaken();
        slug = data.slug;
      }
      const write: CategoryWrite = { slug, name: data.name, sortOrder: data.sortOrder };
      const updated = guardSlug(() => repos.categories.update(id, write));
      if (!updated) throw categoryNotFound();
      return toCategory(updated);
    },

    /** Products in the category become uncategorised (FK ON DELETE SET NULL). */
    remove(id: number): void {
      if (!repos.categories.delete(id)) throw categoryNotFound();
    },
  };
}

export type CategoryService = ReturnType<typeof createCategoryService>;

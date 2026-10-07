import { useId, useState, type FormEvent } from 'react';
import type { Category } from '../../../contracts/types';
import { adminApi, publicApi } from '../lib/api/endpoints';
import { ConfirmButton } from '../components/ConfirmButton';
import { EmptyState, ErrorState, LoadingState, errorMessage } from '../components/States';
import { errorUnder, fieldErrorsFromError } from './fieldErrors';
import { useAdminAsync, useHandleUnauthorized } from './RequireAdmin';

function sortCategories(items: Category[]): Category[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Shows the error for a category save: the name field message if there is one, else the general message. */
function saveErrorText(err: unknown): string {
  const map = fieldErrorsFromError(err);
  return errorUnder(map, 'name') ?? errorUnder(map, 'slug') ?? errorMessage(err);
}

function CategoryRow({
  category,
  onSaved,
  onDeleted,
}: {
  category: Category;
  onSaved: (c: Category) => void;
  onDeleted: (id: number) => void;
}) {
  const id = useId();
  const handle401 = useHandleUnauthorized();
  const [name, setName] = useState(category.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== category.name && name.trim() !== '';

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!changed) return;
    setSaving(true);
    setError(null);
    try {
      // Slug left out on purpose: renaming keeps the existing slug, so shop links keep working.
      const saved = await adminApi.updateCategory(category.id, { name: name.trim(), sortOrder: category.sortOrder });
      onSaved(saved);
      setName(saved.name);
    } catch (err) {
      if (!handle401(err)) setError(saveErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setError(null);
    try {
      await adminApi.deleteCategory(category.id);
      onDeleted(category.id);
    } catch (err) {
      if (!handle401(err)) setError(errorMessage(err));
    }
  }

  return (
    <li className="cat-row">
      <form className="cat-row__form" onSubmit={save} noValidate>
        <label htmlFor={`${id}-name`} className="visually-hidden">
          Name for {category.name}
        </label>
        <input
          id={`${id}-name`}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : `${id}-slug`}
        />
        <span id={`${id}-slug`} className="cat-row__slug">
          /{category.slug}
        </span>
        <button type="submit" className="btn btn--small btn--ghost" disabled={!changed || saving}>
          {saving ? 'Saving…' : 'Rename'}
        </button>
      </form>
      <ConfirmButton
        label="Delete"
        ariaLabel={`Delete category ${category.name}`}
        question={`Delete "${category.name}"? Its shirts become uncategorised.`}
        confirmLabel="Yes, delete"
        onConfirm={remove}
      />
      {error ? (
        <p id={`${id}-err`} className="field__error cat-row__error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function CategoryManager() {
  const id = useId();
  const handle401 = useHandleUnauthorized();
  const categories = useAdminAsync((signal) => publicApi.listCategories({ signal }), []);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (newName.trim() === '') {
      setAddError('Enter a name for the category.');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const created = await adminApi.createCategory({ name: newName.trim() });
      categories.setData((d) => ({ items: sortCategories([...d.items, created]) }));
      setNewName('');
    } catch (err) {
      if (!handle401(err)) setAddError(saveErrorText(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="admin-subtitle">
        Categories
      </h2>
      <p className="admin-help">
        Categories show as filters in the shop. Renaming keeps the web address the same.
      </p>

      {categories.status === 'loading' ? (
        <LoadingState label="Loading categories" />
      ) : categories.status === 'error' ? (
        <ErrorState title="Categories didn't load." error={categories.error} onRetry={categories.reload} />
      ) : categories.data.items.length === 0 ? (
        <EmptyState title="No categories yet.">
          <p>Add one below. Shirts without a category still show in the shop under All shirts.</p>
        </EmptyState>
      ) : (
        <ul className="cat-list">
          {categories.data.items.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              onSaved={(saved) =>
                categories.setData((d) => ({
                  items: sortCategories(d.items.map((x) => (x.id === saved.id ? saved : x))),
                }))
              }
              onDeleted={(removedId) =>
                categories.setData((d) => ({ items: d.items.filter((x) => x.id !== removedId) }))
              }
            />
          ))}
        </ul>
      )}

      <form className="cat-add" onSubmit={add} noValidate>
        <div className="field">
          <label htmlFor={`${id}-new`}>New category</label>
          <div className="cat-add__row">
            <input
              id={`${id}-new`}
              value={newName}
              maxLength={60}
              placeholder="e.g. Classic Cars"
              onChange={(e) => setNewName(e.target.value)}
              aria-invalid={addError ? true : undefined}
              aria-describedby={addError ? `${id}-new-err` : undefined}
            />
            <button type="submit" className="btn btn--admin-primary" disabled={adding}>
              {adding ? 'Adding…' : 'Add category'}
            </button>
          </div>
          {addError ? (
            <p id={`${id}-new-err`} className="field__error" role="alert">
              {addError}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

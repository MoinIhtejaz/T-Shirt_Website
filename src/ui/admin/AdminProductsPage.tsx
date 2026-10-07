import { useState } from 'react';
import { Link } from 'react-router';
import type { AdminProduct } from '../../../contracts/types';
import { adminApi } from '../lib/api/endpoints';
import { formatPrice } from '../lib/api/format';
import { Seo } from '../components/Seo';
import { ConfirmButton } from '../components/ConfirmButton';
import { EmptyState, ErrorState, LoadingState, errorMessage } from '../components/States';
import { Plus, Star } from '../components/Icons';
import { CategoryManager } from './CategoryManager';
import { useAdminAsync, useHandleUnauthorized } from './RequireAdmin';

function StatusBadge({ status }: { status: AdminProduct['status'] }) {
  return <span className={`badge badge--${status}`}>{status === 'published' ? 'Published' : 'Draft'}</span>;
}

export function AdminProductsPage() {
  const handle401 = useHandleUnauthorized();
  const products = useAdminAsync((signal) => adminApi.listProducts({ signal }), []);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function remove(p: AdminProduct) {
    setMessage(null);
    try {
      await adminApi.deleteProduct(p.id);
      products.setData((d) => ({ items: d.items.filter((x) => x.id !== p.id) }));
      setMessage({ kind: 'ok', text: `Deleted "${p.name}".` });
    } catch (err) {
      if (handle401(err)) return;
      setMessage({ kind: 'error', text: `Couldn't delete "${p.name}". ${errorMessage(err)}` });
    }
  }

  return (
    <div className="admin-page">
      <Seo title="Shirts (admin)" />
      <div className="admin-page__head">
        <h1 className="admin-title">Shirts</h1>
        <Link to="/admin/products/new" className="btn btn--admin-primary">
          <Plus width={18} height={18} /> New shirt
        </Link>
      </div>

      <div aria-live="polite">
        {message ? (
          <p className={`notice notice--${message.kind === 'ok' ? 'success' : 'error'}`}>{message.text}</p>
        ) : null}
      </div>

      {products.status === 'loading' ? (
        <LoadingState label="Loading shirts" />
      ) : products.status === 'error' ? (
        <ErrorState title="The shirt list didn't load." error={products.error} onRetry={products.reload} />
      ) : products.data.items.length === 0 ? (
        <EmptyState title="No shirts yet.">
          <p>
            <Link to="/admin/products/new">Add your first shirt</Link> to start the catalogue.
          </p>
        </EmptyState>
      ) : (
        <table className="admin-table">
          <caption className="visually-hidden">All shirts, drafts included</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Photo</span>
              </th>
              <th scope="col">Name</th>
              <th scope="col">Category</th>
              <th scope="col">Price</th>
              <th scope="col">Status</th>
              <th scope="col">Featured</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {products.data.items.map((p) => (
              <tr key={p.id}>
                <td className="admin-table__thumb">
                  {p.primaryImage ? (
                    <img src={p.primaryImage.url} alt="" loading="lazy" />
                  ) : (
                    <span className="admin-table__nothumb" aria-hidden="true" />
                  )}
                </td>
                <td data-label="Name">
                  <Link to={`/admin/products/${p.id}`} className="admin-table__name">
                    {p.name}
                  </Link>
                  <span className="admin-table__slug">/{p.slug}</span>
                </td>
                <td data-label="Category">{p.category?.name ?? <span className="muted">None</span>}</td>
                <td data-label="Price" className="num">
                  {formatPrice(p.priceCents)}
                </td>
                <td data-label="Status">
                  <StatusBadge status={p.status} />
                </td>
                <td data-label="Featured">
                  {p.featured ? (
                    <span className="featured-mark">
                      <Star width={16} height={16} /> Featured
                    </span>
                  ) : (
                    <span className="muted">No</span>
                  )}
                </td>
                <td className="admin-table__actions">
                  <Link to={`/admin/products/${p.id}`} className="btn btn--small btn--ghost" aria-label={`Edit ${p.name}`}>
                    Edit
                  </Link>
                  {p.status === 'published' ? (
                    <a
                      href={`/shirts/${encodeURIComponent(p.slug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn--small btn--ghost"
                      aria-label={`View ${p.name} on the site (opens in a new tab)`}
                    >
                      View
                    </a>
                  ) : null}
                  <ConfirmButton
                    label="Delete"
                    ariaLabel={`Delete ${p.name}`}
                    question={`Delete "${p.name}" and its photos?`}
                    confirmLabel="Yes, delete"
                    onConfirm={() => remove(p)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CategoryManager />
    </div>
  );
}

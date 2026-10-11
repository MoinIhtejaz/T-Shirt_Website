import { Link, useSearchParams } from 'react-router';
import type { Category } from '../../../contracts/types';
import { publicApi } from '../lib/api/endpoints';
import { useAsync } from '../hooks/useAsync';
import { Seo } from '../components/Seo';
import { ProductGrid } from '../components/ProductCard';
import { CardSkeletons, EmptyState, ErrorState, LoadingState } from '../components/States';
import { Refresh } from '../components/Icons';
import { SHOP } from '../content/copy';

function CategoryChips({ active }: { active: string | null }) {
  const categories = useAsync((signal) => publicApi.listCategories({ signal }), []);

  const chip = (slug: string | null, label: string) => {
    const current = active === slug;
    return (
      <li key={slug ?? '__all'}>
        <Link
          to={slug ? `/shop?category=${encodeURIComponent(slug)}` : '/shop'}
          className={`chip${current ? ' chip--active' : ''}`}
          aria-current={current ? 'page' : undefined}
        >
          {label}
        </Link>
      </li>
    );
  };

  return (
    <nav className="chips" aria-label="Filter by category">
      <ul className="chips__list">
        {chip(null, 'All shirts')}
        {categories.status === 'success'
          ? categories.data.items.map((c: Category) => chip(c.slug, c.name))
          : null}
        {categories.status === 'loading' ? (
          <li className="chips__status" role="status">
            <span className="chip chip--skeleton" aria-hidden="true" />
            <span className="chip chip--skeleton" aria-hidden="true" />
            <span className="visually-hidden">Loading categories</span>
          </li>
        ) : null}
        {categories.status === 'error' ? (
          <li className="chips__status">
            <span className="chips__error">Categories didn't load.</span>
            <button type="button" className="btn btn--small btn--ghost" onClick={categories.reload}>
              <Refresh width={16} height={16} /> Try again
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

export function ShopPage() {
  const [params] = useSearchParams();
  const category = params.get('category') || null;
  const products = useAsync((signal) => publicApi.listProducts({ category }, { signal }), [category]);

  const count = products.status === 'success' ? products.data.items.length : null;

  return (
    <div className="page shop">
      <Seo title="Shop" description="Every 2A Marketing t-shirt in one place. Proudly Australian, from Sydney." />
      <header className="page-head container">
        <p className="eyebrow">The range</p>
        <h1 className="page-title">Shop</h1>
        <p className="page-head__lede">{SHOP.intro}</p>
        {count !== null ? (
          <p className="page-head__meta" aria-live="polite">
            {count === 1 ? '1 shirt' : `${count} shirts`}
          </p>
        ) : null}
      </header>

      <div className="container">
        <CategoryChips active={category} />

        {products.status === 'loading' ? (
          <LoadingState label="Loading shirts">
            <CardSkeletons count={6} />
          </LoadingState>
        ) : products.status === 'error' ? (
          <ErrorState title="The shirts didn't load." error={products.error} onRetry={products.reload} />
        ) : products.data.items.length === 0 ? (
          category ? (
            <EmptyState title="No shirts in this category yet.">
              <p>
                <Link to="/shop">Show all shirts</Link>
              </p>
            </EmptyState>
          ) : (
            <EmptyState title="No shirts here yet.">
              <p>Check back soon.</p>
            </EmptyState>
          )
        ) : (
          <ProductGrid products={products.data.items} eagerCount={4} />
        )}
      </div>
    </div>
  );
}

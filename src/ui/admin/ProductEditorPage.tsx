import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { AdminProduct, ProductInput } from '../../../contracts/types';
import { isApiClientError } from '../lib/api/client';
import { adminApi, publicApi } from '../lib/api/endpoints';
import { Seo } from '../components/Seo';
import { ErrorState, LoadingState } from '../components/States';
import { ArrowUpRight } from '../components/Icons';
import { ProductForm } from './ProductForm';
import { ImageManager } from './ImageManager';
import { useAdminAsync, useHandleUnauthorized } from './RequireAdmin';

function BackLink() {
  return (
    <Link to="/admin" className="admin-back">
      ← All shirts
    </Link>
  );
}

export function NewProductPage() {
  const navigate = useNavigate();
  const handle401 = useHandleUnauthorized();
  const categories = useAdminAsync((signal) => publicApi.listCategories({ signal }), []);

  async function create(input: ProductInput): Promise<AdminProduct> {
    const created = await adminApi.createProduct(input);
    navigate(`/admin/products/${created.id}`, { replace: true, state: { created: true } });
    return created;
  }

  return (
    <div className="admin-page admin-page--narrow">
      <Seo title="New shirt (admin)" />
      <BackLink />
      <h1 className="admin-title">New shirt</h1>
      <p className="admin-help">Save the shirt first, then add photos on the next screen.</p>
      {categories.status === 'loading' ? (
        <LoadingState label="Loading the form" />
      ) : categories.status === 'error' ? (
        <ErrorState title="The form didn't load." error={categories.error} onRetry={categories.reload} />
      ) : (
        <ProductForm
          product={null}
          categories={categories.data.items}
          submitLabel="Create shirt"
          onSubmit={create}
          onError={handle401}
        />
      )}
    </div>
  );
}

export function EditProductPage() {
  const params = useParams();
  const location = useLocation();
  const handle401 = useHandleUnauthorized();
  const productId = Number(params.id);
  const validId = Number.isInteger(productId) && productId > 0;
  const [saved, setSaved] = useState<string | null>(
    (location.state as { created?: boolean } | null)?.created ? 'Shirt created. Add photos below.' : null,
  );

  const data = useAdminAsync(
    async (signal) => {
      if (!validId) throw new Error('invalid id');
      const [product, categories] = await Promise.all([
        adminApi.getProduct(productId, { signal }),
        publicApi.listCategories({ signal }),
      ]);
      return { product, categories: categories.items };
    },
    [productId],
  );

  async function update(input: ProductInput): Promise<AdminProduct> {
    setSaved(null);
    const product = await adminApi.updateProduct(productId, input);
    data.setData((d) => ({ ...d, product }));
    setSaved(product.status === 'published' ? 'Changes saved. The shirt is live in the shop.' : 'Changes saved as a draft.');
    return product;
  }

  const notFound =
    !validId || (data.status === 'error' && isApiClientError(data.error) && data.error.status === 404);

  if (notFound) {
    return (
      <div className="admin-page admin-page--narrow">
        <Seo title="Shirt not found (admin)" />
        <BackLink />
        <h1 className="admin-title">This shirt doesn't exist.</h1>
        <p className="admin-help">It may have been deleted. Go back to the list to pick another.</p>
      </div>
    );
  }

  if (data.status === 'loading') {
    return (
      <div className="admin-page admin-page--narrow">
        <Seo title="Edit shirt (admin)" />
        <BackLink />
        <LoadingState label="Loading shirt" />
      </div>
    );
  }

  if (data.status === 'error') {
    return (
      <div className="admin-page admin-page--narrow">
        <Seo title="Edit shirt (admin)" />
        <BackLink />
        <ErrorState title="This shirt didn't load." error={data.error} onRetry={data.reload} />
      </div>
    );
  }

  const { product, categories } = data.data;

  return (
    <div className="admin-page admin-page--narrow">
      <Seo title={`Edit ${product.name} (admin)`} />
      <BackLink />
      <div className="admin-page__head">
        <h1 className="admin-title">{product.name}</h1>
        {product.status === 'published' ? (
          <a
            href={`/shirts/${encodeURIComponent(product.slug)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--small btn--ghost"
          >
            View on site <ArrowUpRight width={16} height={16} />
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        ) : (
          <span className="badge badge--draft">Draft</span>
        )}
      </div>

      <div aria-live="polite">{saved ? <p className="notice notice--success">{saved}</p> : null}</div>

      <ProductForm
        key={product.id}
        product={product}
        categories={categories}
        submitLabel="Save changes"
        onSubmit={update}
        onError={handle401}
      />

      <ImageManager key={`img-${product.id}`} productId={product.id} productName={product.name} initialImages={product.images} />
    </div>
  );
}

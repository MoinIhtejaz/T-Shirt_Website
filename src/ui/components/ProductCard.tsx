import { Link } from 'react-router';
import type { Colour, ProductSummary } from '../../../contracts/types';
import { formatPrice } from '../lib/api/format';

export function ColourDots({ colours, max = 5 }: { colours: Colour[]; max?: number }) {
  if (colours.length === 0) return null;
  const shown = colours.slice(0, max);
  const extra = colours.length - shown.length;
  return (
    <p className="colour-dots">
      <span className="visually-hidden">Colours: {colours.map((c) => c.name).join(', ')}</span>
      <span aria-hidden="true" className="colour-dots__row">
        {shown.map((c, i) => (
          <span key={`${c.hex}-${i}`} className="colour-dot" style={{ backgroundColor: c.hex }} title={c.name} />
        ))}
        {extra > 0 ? <span className="colour-dots__more">+{extra}</span> : null}
      </span>
    </p>
  );
}

export function ProductImageFrame({
  src,
  alt,
  className = '',
  loading = 'lazy',
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  return (
    <div className={`product-frame ${className}`}>
      {src ? (
        <img src={src} alt={alt} loading={loading} decoding="async" />
      ) : (
        <span className="product-frame__empty">Photo coming soon</span>
      )}
    </div>
  );
}

export function ProductCard({ product, eager = false }: { product: ProductSummary; eager?: boolean }) {
  const img = product.primaryImage;
  return (
    <li className="product-card">
      <Link to={`/shirts/${encodeURIComponent(product.slug)}`} className="product-card__link">
        <ProductImageFrame
          src={img?.url}
          alt={img?.alt || product.name}
          className="product-card__frame"
          loading={eager ? 'eager' : 'lazy'}
        />
        <span className="product-card__meta">
          {product.category ? <span className="eyebrow product-card__cat">{product.category.name}</span> : null}
          <span className="product-card__row">
            <span className="product-card__name">{product.name}</span>
            <span className="product-card__price">{formatPrice(product.priceCents)}</span>
          </span>
        </span>
      </Link>
      <ColourDots colours={product.colours} />
    </li>
  );
}

export function ProductGrid({ products, eagerCount = 0 }: { products: ProductSummary[]; eagerCount?: number }) {
  return (
    <ul className="product-grid">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} eager={i < eagerCount} />
      ))}
    </ul>
  );
}

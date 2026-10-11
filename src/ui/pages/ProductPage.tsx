import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { Product } from '../../../contracts/types';
import { isApiClientError } from '../lib/api/client';
import { publicApi } from '../lib/api/endpoints';
import { formatPrice } from '../lib/api/format';
import { useAsync } from '../hooks/useAsync';
import { Seo } from '../components/Seo';
import { ErrorState, LoadingState } from '../components/States';
import { ProductImageFrame } from '../components/ProductCard';
import { ArrowUpRight, Ruler } from '../components/Icons';
import { NotFoundPage } from './NotFoundPage';

/** Plain-text description -> paragraphs. Newlines are paragraph breaks. Never parsed as HTML. */
export function toParagraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function Gallery({ product }: { product: Product }) {
  const [index, setIndex] = useState(0);
  const images = product.images;

  useEffect(() => setIndex(0), [product.id]);

  if (images.length === 0) {
    return (
      <div className="gallery">
        <ProductImageFrame src={null} alt="" className="gallery__main" />
      </div>
    );
  }

  const current = images[Math.min(index, images.length - 1)];

  return (
    <div className="gallery">
      <ProductImageFrame
        src={current.url}
        alt={current.alt || product.name}
        className="gallery__main"
        loading="eager"
      />
      {images.length > 1 ? (
        <ul className="gallery__thumbs" aria-label="Product photos">
          {images.map((img, i) => (
            <li key={img.id}>
              <button
                type="button"
                className="gallery__thumb"
                aria-label={`Show photo ${i + 1} of ${images.length}`}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
              >
                <img src={img.url} alt="" loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ProductDetail({ product }: { product: Product }) {
  const paragraphs = toParagraphs(product.description);
  const description = paragraphs[0]?.slice(0, 160) || `${product.name} from 2A Marketing, Sydney.`;

  return (
    <article className="product container">
      <Seo title={product.name} description={description} />
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ol>
          <li>
            <Link to="/shop">Shop</Link>
          </li>
          {product.category ? (
            <li>
              <Link to={`/shop?category=${encodeURIComponent(product.category.slug)}`}>{product.category.name}</Link>
            </li>
          ) : null}
          <li aria-current="page">{product.name}</li>
        </ol>
      </nav>

      <div className="product__layout">
        <Gallery product={product} />

        <div className="product__info">
          {product.category ? <p className="eyebrow">{product.category.name}</p> : null}
          <h1 className="product__name">{product.name}</h1>
          <p className="product__price">
            <span className="visually-hidden">Price: </span>
            {formatPrice(product.priceCents)}
            <span className="product__currency"> AUD</span>
          </p>

          {product.colours.length > 0 ? (
            <section className="product__block" aria-labelledby="colours-label">
              <h2 id="colours-label" className="product__label">
                Colours
              </h2>
              <ul className="swatches">
                {product.colours.map((c, i) => (
                  <li key={`${c.hex}-${i}`} className="swatch">
                    <span className="swatch__chip" style={{ backgroundColor: c.hex }} aria-hidden="true" />
                    <span className="swatch__name">{c.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {product.sizes.length > 0 ? (
            <section className="product__block" aria-labelledby="sizes-label">
              <h2 id="sizes-label" className="product__label">
                Sizes
              </h2>
              <ul className="sizes">
                {product.sizes.map((s) => (
                  <li key={s} className="sizes__item">
                    {s}
                  </li>
                ))}
              </ul>
              <Link to="/size-guide" className="text-link product__size-link">
                <Ruler width={18} height={18} /> Check the size guide
              </Link>
            </section>
          ) : null}

          <div className="product__buy">
            {product.amazonUrl ? (
              <>
                <a
                  className="btn btn--primary btn--buy"
                  href={product.amazonUrl}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                >
                  Buy on Amazon <ArrowUpRight />
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
                <p className="product__note">
                  Price and availability are confirmed on Amazon and may differ from what's shown here.
                </p>
              </>
            ) : (
              <p className="product__note">Our shirts are sold on Amazon, eBay and Depop, and at stalls across Sydney.</p>
            )}
          </div>

          {paragraphs.length > 0 ? (
            <section className="product__desc" aria-labelledby="desc-label">
              <h2 id="desc-label" className="product__label">
                About this shirt
              </h2>
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ProductPage() {
  const { slug = '' } = useParams();
  const product = useAsync((signal) => publicApi.getProduct(slug, { signal }), [slug]);

  if (product.status === 'loading') {
    return (
      <div className="page container">
        <LoadingState label="Loading shirt">
          <div className="product__layout product__layout--skeleton" aria-hidden="true">
            <div className="product-frame skeleton" />
            <div>
              <div className="skeleton skeleton--title" />
              <div className="skeleton skeleton--line skeleton--short" />
              <div className="skeleton skeleton--button" />
            </div>
          </div>
        </LoadingState>
      </div>
    );
  }

  if (product.status === 'error') {
    if (isApiClientError(product.error) && product.error.status === 404) {
      return (
        <NotFoundPage
          title="This shirt isn't here."
          body="It may have been taken down, or the link is out of date. The rest of the range is in the shop."
        />
      );
    }
    return (
      <div className="page container">
        <Seo title="Shirt" />
        <ErrorState title="This shirt didn't load." error={product.error} onRetry={product.reload} />
      </div>
    );
  }

  return <ProductDetail product={product.data} />;
}

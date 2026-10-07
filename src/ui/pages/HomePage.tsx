import { Link } from 'react-router';
import { publicApi } from '../lib/api/endpoints';
import { useAsync } from '../hooks/useAsync';
import { Seo } from '../components/Seo';
import { ProductGrid } from '../components/ProductCard';
import { CardSkeletons, EmptyState, ErrorState, LoadingState } from '../components/States';
import { Waterline } from '../components/Waterline';
import { ArrowRight } from '../components/Icons';
import { BRAND, HOME, SITE } from '../content/copy';

export function HomePage() {
  const featured = useAsync((signal) => publicApi.listProducts({ featured: true }, { signal }), []);

  return (
    <>
      <Seo title={BRAND.name} description={SITE.description} />

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__inner">
          <p className="eyebrow hero__eyebrow">
            <span>{HOME.eyebrow}</span>
            <span className="hero__coords">{BRAND.coordinates}</span>
          </p>
          <h1 id="hero-title" className="hero__title">
            {HOME.headline.map((line) => (
              <span key={line} className="hero__line">
                {line}
              </span>
            ))}
          </h1>
          <p className="hero__lede">{HOME.lede}</p>
          <div className="hero__actions">
            <Link to="/shop" className="btn btn--primary">
              {HOME.primaryCta} <ArrowRight />
            </Link>
            <Link to="/about" className="btn btn--link">
              {HOME.secondaryCta}
            </Link>
          </div>
        </div>
        <div className="hero__sun" aria-hidden="true" />
        <Waterline className="hero__waterline" />
      </section>

      <section className="featured" aria-labelledby="featured-title">
        <div className="container">
          <div className="section-head section-head--on-dark">
            <h2 id="featured-title" className="section-title">
              {HOME.featuredTitle}
            </h2>
            <Link to="/shop" className="section-head__link">
              {HOME.featuredLink} <ArrowRight />
            </Link>
          </div>

          {featured.status === 'loading' ? (
            <LoadingState label="Loading featured shirts">
              <CardSkeletons count={3} />
            </LoadingState>
          ) : featured.status === 'error' ? (
            <ErrorState title="The featured shirts didn't load." error={featured.error} onRetry={featured.reload} />
          ) : featured.data.items.length === 0 ? (
            <EmptyState title="No featured shirts right now.">
              <p>
                The full range is in the <Link to="/shop">shop</Link>.
              </p>
            </EmptyState>
          ) : (
            <ProductGrid products={featured.data.items} eagerCount={2} />
          )}
        </div>
      </section>

      <section className="story-teaser" aria-labelledby="story-title">
        <div className="container story-teaser__inner">
          <h2 id="story-title" className="visually-hidden">
            About us
          </h2>
          <blockquote className="story-teaser__quote">
            <p>{HOME.storyQuote}</p>
          </blockquote>
          <div className="story-teaser__body">
            <p>{HOME.storyBody}</p>
            <Link to="/about" className="text-link">
              {HOME.storyLink} <ArrowRight />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

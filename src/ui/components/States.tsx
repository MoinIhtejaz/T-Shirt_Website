import type { ReactNode } from 'react';
import { isApiClientError } from '../lib/api/client';
import { Refresh } from './Icons';

export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again in a moment.'): string {
  if (isApiClientError(error)) return error.message;
  return fallback;
}

export function LoadingState({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {children ?? <div className="state__spinner" aria-hidden="true" />}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      {children ? <div className="state__body">{children}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">{title}</p>
      <p className="state__body">{errorMessage(error)}</p>
      {onRetry ? (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          <Refresh /> Try again
        </button>
      ) : null}
    </div>
  );
}

/** A grid of placeholder cards shown while products load. */
export function CardSkeletons({ count = 4 }: { count?: number }) {
  return (
    <ul className="product-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="product-card product-card--skeleton">
          <div className="product-card__frame skeleton" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--short" />
        </li>
      ))}
    </ul>
  );
}

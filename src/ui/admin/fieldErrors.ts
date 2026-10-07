import type { FieldError } from '../../../contracts/types';
import { isApiClientError } from '../lib/api/client';

/** Field path (e.g. "colours.1.hex") -> message. */
export type FieldErrorMap = Record<string, string>;

export function toFieldErrorMap(details: FieldError[]): FieldErrorMap {
  const map: FieldErrorMap = {};
  for (const d of details) {
    // Keep the first message per path; the server lists the most relevant first.
    const key = d.field.trim();
    if (!(key in map)) map[key] = d.message;
  }
  return map;
}

/**
 * Field errors to show for a failed save. VALIDATION_FAILED uses `details`.
 * SLUG_TAKEN always lands on "slug", using the detail message when the server gives one.
 */
export function fieldErrorsFromError(err: unknown): FieldErrorMap {
  if (!isApiClientError(err)) return {};
  const map = toFieldErrorMap(err.details);
  if (err.code === 'SLUG_TAKEN' && !map.slug) {
    map.slug = err.message || 'That slug is already in use.';
  }
  return map;
}

/** Exact match first, then the first message for any nested path under `prefix`. */
export function errorUnder(map: FieldErrorMap, prefix: string): string | undefined {
  if (map[prefix]) return map[prefix];
  const nested = Object.keys(map).find((k) => k.startsWith(`${prefix}.`));
  return nested ? map[nested] : undefined;
}

/** Messages whose paths don't match any field the form knows about. */
export function unmatchedErrors(map: FieldErrorMap, isKnown: (path: string) => boolean): string[] {
  return Object.entries(map)
    .filter(([path]) => !isKnown(path))
    .map(([path, message]) => (path ? `${path}: ${message}` : message));
}

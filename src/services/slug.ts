// Slug rules from contracts/openapi.yaml info.description.
import { HttpError } from '../shared/http';

export const SLUG_MAX = 80;

function trimHyphens(s: string): string {
  return s.replace(/^-+|-+$/g, '');
}

/** lowercase, NFKD without diacritics, non-alphanumerics -> "-", trimmed, max 80. "" becomes the fallback. */
export function slugify(name: string, fallback: 'shirt' | 'category'): string {
  const slug = trimHyphens(
    trimHyphens(
      name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9]+/g, '-'),
    ).slice(0, SLUG_MAX),
  );
  return slug === '' ? fallback : slug;
}

/** First of base, base-2, base-3, ... that `isTaken` rejects, kept within 80 chars. */
export function uniqueSlug(base: string, isTaken: (slug: string) => boolean): string {
  if (!isTaken(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${trimHyphens(base.slice(0, SLUG_MAX - suffix.length))}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
}

export function slugTaken(): HttpError {
  return new HttpError(409, 'SLUG_TAKEN', 'That slug is already in use.', [
    { field: 'slug', message: 'This slug is already in use. Pick another one.' },
  ]);
}

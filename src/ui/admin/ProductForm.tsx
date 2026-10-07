import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { SIZES } from '../../../contracts/types';
import type { AdminProduct, Category, ProductInput, ProductStatus, Size } from '../../../contracts/types';
import { isApiClientError } from '../lib/api/client';
import { centsToDollarsInput, dollarsInputToCents } from '../lib/api/format';
import { Plus } from '../components/Icons';
import { errorUnder, fieldErrorsFromError, unmatchedErrors, type FieldErrorMap } from './fieldErrors';

interface ColourDraft {
  key: number;
  name: string;
  hex: string;
}

interface FormValues {
  name: string;
  slug: string;
  description: string;
  price: string; // dollars, as typed
  categoryId: string; // "" = no category
  colours: ColourDraft[];
  sizes: Size[];
  amazonUrl: string;
  featured: boolean;
  status: ProductStatus;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const KNOWN_ROOTS = ['name', 'slug', 'description', 'priceCents', 'categoryId', 'colours', 'sizes', 'amazonUrl', 'featured', 'status'];

let colourKey = 0;
const nextKey = () => ++colourKey;

function toValues(p: AdminProduct | null): FormValues {
  if (!p) {
    return {
      name: '',
      slug: '',
      description: '',
      price: '',
      categoryId: '',
      colours: [{ key: nextKey(), name: '', hex: '#1F4E6B' }],
      sizes: ['S', 'M', 'L', 'XL'],
      amazonUrl: '',
      featured: false,
      status: 'draft',
    };
  }
  return {
    name: p.name,
    slug: p.slug,
    description: p.description,
    price: centsToDollarsInput(p.priceCents),
    categoryId: p.categoryId === null ? '' : String(p.categoryId),
    colours: p.colours.map((c) => ({ key: nextKey(), name: c.name, hex: c.hex })),
    sizes: SIZES.filter((s) => p.sizes.includes(s)),
    amazonUrl: p.amazonUrl,
    featured: p.featured,
    status: p.status,
  };
}

/** Builds the request body. Returns client-side field errors instead when something can't be sent. */
export function buildProductInput(v: FormValues): { input: ProductInput } | { errors: FieldErrorMap } {
  const errors: FieldErrorMap = {};
  const priceCents = dollarsInputToCents(v.price);
  if (v.name.trim() === '') errors.name = 'Enter a name for the shirt.';
  if (priceCents === null) errors.priceCents = 'Enter a price in dollars, like 49 or 49.95.';
  if (Object.keys(errors).length > 0) return { errors };

  return {
    input: {
      name: v.name.trim(),
      slug: v.slug.trim(),
      description: v.description,
      priceCents: priceCents as number,
      categoryId: v.categoryId === '' ? null : Number(v.categoryId),
      colours: v.colours.map((c) => ({ name: c.name.trim(), hex: c.hex.trim().toUpperCase() })),
      sizes: SIZES.filter((s) => v.sizes.includes(s)),
      amazonUrl: v.amazonUrl.trim(),
      featured: v.featured,
      status: v.status,
    },
  };
}

function isKnownPath(path: string): boolean {
  return KNOWN_ROOTS.some((root) => path === root || path.startsWith(`${root}.`));
}

interface FieldProps {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  children: (aria: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
  className?: string;
}

function Field({ id, label, error, hint, children, className = '' }: FieldProps) {
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint ? (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} className="field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface ProductFormProps {
  product: AdminProduct | null;
  categories: Category[];
  submitLabel: string;
  /** Saves the input and resolves with the saved product. Throws ApiClientError on failure. */
  onSubmit: (input: ProductInput) => Promise<AdminProduct>;
  /** Called with errors after a failed save, so the page can handle a 401. Return true to stop. */
  onError?: (err: unknown) => boolean;
}

export function ProductForm({ product, categories, submitLabel, onSubmit, onError }: ProductFormProps) {
  const uid = useId();
  const fid = (path: string) => `${uid}-${path.replace(/\./g, '-')}`;
  const [values, setValues] = useState<FormValues>(() => toValues(product));
  const [errors, setErrors] = useState<FieldErrorMap>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const setColour = (key: number, patch: Partial<ColourDraft>) =>
    setValues((v) => ({ ...v, colours: v.colours.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));

  function showErrors(map: FieldErrorMap, message: string) {
    setErrors(map);
    setSummary(message);
    // Wait for the summary to render, then move focus so screen readers hear it.
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const built = buildProductInput(values);
    if ('errors' in built) {
      showErrors(built.errors, 'Some fields need fixing.');
      return;
    }
    setSaving(true);
    setErrors({});
    setSummary(null);
    try {
      const saved = await onSubmit(built.input);
      setValues(toValues(saved));
    } catch (err) {
      if (onError?.(err)) return;
      const map = fieldErrorsFromError(err);
      const message = isApiClientError(err) ? err.message : 'Something went wrong. Try again.';
      showErrors(map, message);
    } finally {
      setSaving(false);
    }
  }

  const err = (path: string) => errors[path];
  const extra = unmatchedErrors(errors, isKnownPath);
  const coloursListError = errors.colours;
  const sizesError = errorUnder(errors, 'sizes');

  return (
    <form className="form product-form" onSubmit={submit} noValidate>
      {summary ? (
        <div ref={summaryRef} tabIndex={-1} className="notice notice--error" role="alert">
          <p>{summary}</p>
          {extra.length > 0 ? (
            <ul>
              {extra.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <fieldset className="form-section">
        <legend>Basics</legend>
        <Field id={fid('name')} label="Name" error={err('name')}>
          {(a) => (
            <input {...a} value={values.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
          )}
        </Field>

        <Field
          id={fid('slug')}
          label="Web address"
          error={err('slug')}
          hint={
            product
              ? 'Lowercase letters, numbers and hyphens. Leave blank to keep the current address.'
              : 'Lowercase letters, numbers and hyphens. Leave blank to make one from the name.'
          }
        >
          {(a) => (
            <div className="input-prefix">
              <span aria-hidden="true">/shirts/</span>
              <input
                {...a}
                value={values.slug}
                maxLength={80}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => set('slug', e.target.value)}
              />
            </div>
          )}
        </Field>

        <div className="form-row">
          <Field id={fid('priceCents')} label="Price (AUD)" error={err('priceCents')} hint="In dollars, e.g. 49.95">
            {(a) => (
              <div className="input-prefix">
                <span aria-hidden="true">$</span>
                <input
                  {...a}
                  inputMode="decimal"
                  value={values.price}
                  onChange={(e) => set('price', e.target.value)}
                />
              </div>
            )}
          </Field>

          <Field id={fid('categoryId')} label="Category" error={err('categoryId')}>
            {(a) => (
              <select {...a} value={values.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field
          id={fid('description')}
          label="Description"
          error={err('description')}
          hint="Plain text. Start a new line for a new paragraph."
        >
          {(a) => (
            <textarea
              {...a}
              rows={6}
              maxLength={4000}
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>

        <Field
          id={fid('amazonUrl')}
          label="Amazon link"
          error={err('amazonUrl')}
          hint="Paste the https link to the Amazon listing (amazon.com.au, amazon.com, amzn.to or amzn.asia)."
        >
          {(a) => (
            <input
              {...a}
              type="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="https://www.amazon.com.au/dp/…"
              maxLength={2048}
              value={values.amazonUrl}
              onChange={(e) => set('amazonUrl', e.target.value)}
            />
          )}
        </Field>
      </fieldset>

      <fieldset
        className="form-section"
        aria-describedby={coloursListError ? `${fid('colours')}-err` : undefined}
      >
        <legend>Colours</legend>
        {values.colours.length === 0 ? <p className="field__hint">No colours listed. Add one below.</p> : null}
        <ul className="colour-list">
          {values.colours.map((c, i) => {
            const nameId = fid(`colours.${i}.name`);
            const hexId = fid(`colours.${i}.hex`);
            const nameErr = err(`colours.${i}.name`);
            const hexErr = err(`colours.${i}.hex`);
            const rowErr = err(`colours.${i}`);
            return (
              <li key={c.key} className="colour-row">
                <div className="field colour-row__name">
                  <label htmlFor={nameId}>Colour {i + 1} name</label>
                  <input
                    id={nameId}
                    value={c.name}
                    maxLength={40}
                    placeholder="e.g. Stone"
                    onChange={(e) => setColour(c.key, { name: e.target.value })}
                    aria-invalid={nameErr ? true : undefined}
                    aria-describedby={nameErr ? `${nameId}-err` : undefined}
                  />
                  {nameErr ? (
                    <p id={`${nameId}-err`} className="field__error">
                      {nameErr}
                    </p>
                  ) : null}
                </div>
                <div className="field colour-row__hex">
                  <label htmlFor={hexId}>Hex</label>
                  <div className="colour-row__pick">
                    <input
                      type="color"
                      aria-label={`Pick colour ${i + 1}`}
                      value={HEX_RE.test(c.hex) ? c.hex.toLowerCase() : '#000000'}
                      onChange={(e) => setColour(c.key, { hex: e.target.value.toUpperCase() })}
                    />
                    <input
                      id={hexId}
                      value={c.hex}
                      maxLength={7}
                      spellCheck={false}
                      autoCapitalize="characters"
                      onChange={(e) => setColour(c.key, { hex: e.target.value })}
                      aria-invalid={hexErr ? true : undefined}
                      aria-describedby={hexErr ? `${hexId}-err` : undefined}
                    />
                  </div>
                  {hexErr ? (
                    <p id={`${hexId}-err`} className="field__error">
                      {hexErr}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--danger-quiet colour-row__remove"
                  onClick={() => set('colours', values.colours.filter((x) => x.key !== c.key))}
                  aria-label={`Remove colour ${i + 1}${c.name ? ` (${c.name})` : ''}`}
                >
                  Remove
                </button>
                {rowErr ? <p className="field__error colour-row__err">{rowErr}</p> : null}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          disabled={values.colours.length >= 12}
          onClick={() => set('colours', [...values.colours, { key: nextKey(), name: '', hex: '#F3EDE2' }])}
        >
          <Plus width={16} height={16} /> Add colour
        </button>
        {coloursListError ? (
          <p id={`${fid('colours')}-err`} className="field__error">
            {coloursListError}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="form-section" aria-describedby={sizesError ? `${fid('sizes')}-err` : undefined}>
        <legend>Sizes</legend>
        <div className="check-row">
          {SIZES.map((s) => (
            <label key={s} className="check">
              <input
                type="checkbox"
                checked={values.sizes.includes(s)}
                onChange={(e) =>
                  set(
                    'sizes',
                    e.target.checked
                      ? SIZES.filter((x) => x === s || values.sizes.includes(x))
                      : values.sizes.filter((x) => x !== s),
                  )
                }
              />
              <span>{s}</span>
            </label>
          ))}
        </div>
        {sizesError ? (
          <p id={`${fid('sizes')}-err`} className="field__error">
            {sizesError}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="form-section">
        <legend>Visibility</legend>
        <div
          className="segmented"
          role="radiogroup"
          aria-label="Status"
          aria-describedby={err('status') ? `${fid('status')}-err` : `${fid('status')}-hint`}
        >
          {(['draft', 'published'] as const).map((s) => (
            <label key={s} className="segmented__opt">
              <input
                type="radio"
                name={`${uid}-status`}
                value={s}
                checked={values.status === s}
                onChange={() => set('status', s)}
              />
              <span>{s === 'draft' ? 'Draft' : 'Published'}</span>
            </label>
          ))}
        </div>
        <p id={`${fid('status')}-hint`} className="field__hint">
          Drafts are only visible here. Published shirts show in the shop.
        </p>
        {err('status') ? (
          <p id={`${fid('status')}-err`} className="field__error">
            {err('status')}
          </p>
        ) : null}

        <label className="check check--block">
          <input type="checkbox" checked={values.featured} onChange={(e) => set('featured', e.target.checked)} />
          <span>Feature on the home page</span>
        </label>
        {err('featured') ? <p className="field__error">{err('featured')}</p> : null}
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="btn btn--admin-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

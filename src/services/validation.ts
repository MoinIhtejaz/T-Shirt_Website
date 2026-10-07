// Request validation (zod 4). Every schema is strict, trims strings before length
// checks, and reports problems as FieldError[] with plain-English messages.
import { z } from 'zod';
import { SIZES, type FieldError, type Size } from '../../contracts/types';
import { HttpError } from '../shared/http';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const VALIDATION_MESSAGE = 'Some fields need fixing.';
const AMAZON_MESSAGE = 'Must be an https link to Amazon.';

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

const TYPE_NAMES: Record<string, string> = {
  string: 'text',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  array: 'a list',
  object: 'an object',
};

function plural(n: number | bigint, word: string): string {
  return `${n} ${word}${n === 1 || n === 1n ? '' : 's'}`;
}

/** Fallback wording for any issue a schema didn't give its own message. */
function issueMessage(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined) return 'This field is required.';
      return `Must be ${TYPE_NAMES[issue.expected] ?? `of type ${issue.expected}`}.`;
    case 'too_small':
      if (issue.origin === 'string') {
        return issue.minimum === 1 ? 'This field is required.' : `Must be at least ${plural(issue.minimum, 'character')}.`;
      }
      if (issue.origin === 'array') return `Add at least ${plural(issue.minimum, 'item')}.`;
      return `Must be ${issue.minimum} or more.`;
    case 'too_big':
      if (issue.origin === 'string') return `Must be ${plural(issue.maximum, 'character')} or fewer.`;
      if (issue.origin === 'array') return `Can't have more than ${plural(issue.maximum, 'item')}.`;
      return `Must be ${issue.maximum} or less.`;
    case 'invalid_value':
      if (issue.input === undefined) return 'This field is required.';
      return `Must be one of: ${issue.values.map(String).join(', ')}.`;
    case 'invalid_format':
      return 'This value has the wrong format.';
    case 'unrecognized_keys':
      return 'Unknown field.';
    default:
      return 'This value is not valid.';
  }
}

/** Converts zod issues to FieldError[]. Unknown keys get one entry each; the body root is "body". */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  const out: FieldError[] = [];
  for (const issue of error.issues) {
    const base = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) out.push({ field: [...base, key].join('.'), message: 'Unknown field.' });
      continue;
    }
    out.push({ field: base.length > 0 ? base.join('.') : 'body', message: issue.message });
  }
  return out;
}

export function validationError(details: FieldError[]): HttpError {
  return new HttpError(400, 'VALIDATION_FAILED', VALIDATION_MESSAGE, details);
}

/** Parses with human-readable messages, or throws 400 VALIDATION_FAILED with field details. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input, { error: issueMessage });
  if (!result.success) throw validationError(toFieldErrors(result.error));
  return result.data;
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const text = (max: number, min = 0) => {
  const s = z.string().trim();
  return (min > 0 ? s.min(min) : s).max(max);
};

/** Omitted or "" means "generate" (create) or "keep" (update). */
const slugField = z
  .string()
  .trim()
  .max(80, { error: 'Must be 80 characters or fewer.', abort: true })
  .refine((s) => s === '' || SLUG_PATTERN.test(s), {
    error: 'Use lowercase letters and numbers, with single hyphens between words.',
  })
  .optional();

const colourSchema = z.strictObject({
  name: text(40, 1),
  hex: z
    .string()
    .trim()
    .regex(HEX_PATTERN, { error: 'Use a hex colour like #1A2B3C.' })
    .transform((s) => s.toUpperCase()),
});

const sizesSchema = z
  .array(z.enum(SIZES, { error: `Must be one of: ${SIZES.join(', ')}.` }))
  .max(6)
  .superRefine((sizes, ctx) => {
    const seen = new Set<string>();
    sizes.forEach((size, i) => {
      if (seen.has(size)) ctx.addIssue({ code: 'custom', path: [i], message: `${size} is listed more than once.` });
      seen.add(size);
    });
  })
  .transform((sizes): Size[] => SIZES.filter((s) => sizes.includes(s)));

export function productInputSchema(isAllowedAmazonUrl: (url: string) => boolean) {
  return z.strictObject({
    name: text(120, 1),
    slug: slugField,
    description: text(4000),
    priceCents: z
      .int({ error: (iss) => (iss.input === undefined ? undefined : 'Price must be a whole number of cents.') })
      .min(0, { error: "Price can't be negative." })
      .max(1_000_000, { error: 'Price must be 1000000 cents ($10,000) or less.' }),
    categoryId: z
      .int({ error: (iss) => (iss.input === undefined ? undefined : 'Pick a category, or leave it empty.') })
      .nullable(),
    colours: z.array(colourSchema).max(12),
    sizes: sizesSchema,
    amazonUrl: z
      .string()
      .trim()
      .max(2048, { error: 'Must be 2048 characters or fewer.', abort: true })
      .refine((url) => isAllowedAmazonUrl(url), { error: AMAZON_MESSAGE }),
    featured: z.boolean(),
    status: z.enum(['draft', 'published'], {
      error: (iss) => (iss.input === undefined ? undefined : 'Must be draft or published.'),
    }),
  });
}

export const categoryInputSchema = z.strictObject({
  name: text(60, 1),
  slug: slugField,
  sortOrder: z.int().min(-1000).max(1000).default(0),
});

export const imageUpdateSchema = z
  .strictObject({
    alt: text(200).optional(),
    sortOrder: z.int().min(0).max(1000).optional(),
  })
  .refine((o) => o.alt !== undefined || o.sortOrder !== undefined, {
    error: 'Send alt, sortOrder or both.',
  });

/** Text fields that may accompany an upload (multipart). */
export const imageUploadFieldsSchema = z.strictObject({
  alt: text(200).optional(),
});

export type ProductInputData = z.output<ReturnType<typeof productInputSchema>>;
export type CategoryInputData = z.output<typeof categoryInputSchema>;
export type ImageUpdateData = z.output<typeof imageUpdateSchema>;

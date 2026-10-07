const audFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

/** 4995 -> "$49.95" */
export function formatPrice(priceCents: number): string {
  return audFormatter.format(priceCents / 100);
}

/** 4995 -> "49.95" for an editable dollars field. */
export function centsToDollarsInput(priceCents: number): string {
  return (priceCents / 100).toFixed(2);
}

/**
 * "49", "49.9", "49.95", "$1,049.95" -> integer cents. Returns null when the text
 * isn't a plain non-negative dollar amount with at most two decimal places.
 */
export function dollarsInputToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

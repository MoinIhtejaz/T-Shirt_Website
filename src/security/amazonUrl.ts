// Security layer: Amazon link allow-list (SEC-003).
// Implements contracts/openapi.yaml#/components/schemas/AmazonUrl, plus a few
// stricter checks on the raw string so the stored text is exactly what a
// browser will navigate to.

export const ALLOWED_AMAZON_HOSTS: ReadonlySet<string> = new Set([
  'amazon.com.au',
  'www.amazon.com.au',
  'amazon.com',
  'www.amazon.com',
  'amzn.to',
  'amzn.asia',
]);

export const AMAZON_URL_MAX_LENGTH = 2048;

// Printable ASCII only: no spaces, tabs, newlines, control or non-ASCII characters.
// The WHATWG parser silently strips or remaps several of these, which is how
// "looks like Amazon" tricks slip through.
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const HTTPS_PREFIX = /^https:\/\//i;

export function isAllowedAmazonUrl(url: string): boolean {
  const raw: unknown = url;
  if (typeof raw !== 'string') return false;
  if (raw.length === 0 || raw.length > AMAZON_URL_MAX_LENGTH) return false;
  if (!PRINTABLE_ASCII.test(raw)) return false;
  // WHATWG treats "\" as "/" in https URLs, which lets the raw text disagree with the parsed host.
  if (raw.includes('\\')) return false;
  // Rejects "https:amazon.com", "//amazon.com", "http://", "javascript:", "data:" and friends.
  if (!HTTPS_PREFIX.test(raw)) return false;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (parsed.port !== '') return false;

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_AMAZON_HOSTS.has(hostname)) return false;

  // The authority as typed must be exactly the hostname: no userinfo (even an
  // empty "@"), no port (even ":443"), no percent-encoding, no extra slashes.
  const authority = raw.slice('https://'.length).split(/[/?#]/, 1)[0] ?? '';
  return authority.toLowerCase() === hostname;
}

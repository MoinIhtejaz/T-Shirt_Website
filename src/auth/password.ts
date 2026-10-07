// Password hashing per contracts/auth.md#password-storage.
import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

// Upper bounds for parameters parsed from a stored hash, so a corrupt row
// can't make verification allocate unbounded memory.
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;
const MAX_KEYLEN = 256;

const B64URL = /^[A-Za-z0-9_-]+$/;
const POSITIVE_INT = /^[1-9][0-9]{0,9}$/;

/** scrypt needs 128 * N * r bytes; give it double that plus headroom. */
function maxmemFor(n: number, r: number, p: number): number {
  return 128 * n * r * 2 + 128 * r * p + 1024 * 1024;
}

function scrypt(plain: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(plain, salt, keylen, { N: n, r, p, maxmem: maxmemFor(n, r, p) }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await scrypt(plain, salt, KEYLEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

interface ParsedHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseStored(stored: unknown): ParsedHash | null {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, nStr, rStr, pStr, saltStr, hashStr] = parts;
  if (!POSITIVE_INT.test(nStr) || !POSITIVE_INT.test(rStr) || !POSITIVE_INT.test(pStr)) return null;
  if (!B64URL.test(saltStr) || !B64URL.test(hashStr)) return null;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (n < 2 || n > MAX_N || (n & (n - 1)) !== 0) return null;
  if (r > MAX_R || p > MAX_P) return null;
  const salt = Buffer.from(saltStr, 'base64url');
  const hash = Buffer.from(hashStr, 'base64url');
  if (salt.length === 0 || hash.length === 0 || hash.length > MAX_KEYLEN) return null;
  return { n, r, p, salt, hash };
}

/** true only if `plain` matches `stored`. A malformed stored hash returns false; never throws. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    if (typeof plain !== 'string') return false;
    const parsed = parseStored(stored);
    if (!parsed) return false;
    const derived = await scrypt(plain, parsed.salt, parsed.hash.length, parsed.n, parsed.r, parsed.p);
    return derived.length === parsed.hash.length && crypto.timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

/**
 * Valid-format hash of a random secret nobody knows. Login verifies against
 * it when the email is unknown, so timing doesn't reveal which emails exist.
 */
export const DUMMY_HASH =
  'scrypt$16384$8$1$pjOIWnII4GKZr1ZileRD5w$g6O6ODnYwdHlKP2LIjhJnwMPlzCRz-cigsU__fTYJl5SSapJN1pFfZe3p_G8Rwwjah_7nXHE22_chJpRJZZW_w';

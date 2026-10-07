// AUTH-001: scrypt password hashing and verification.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/index';

const FORMAT = /^scrypt\$16384\$8\$1\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

describe('hashPassword', () => {
  it('produces scrypt$16384$8$1$<salt b64url>$<hash b64url> with a 16-byte salt and 64-byte key', async () => {
    const stored = await hashPassword('a long enough password');
    const m = FORMAT.exec(stored);
    expect(m).not.toBeNull();
    expect(Buffer.from(m![1], 'base64url')).toHaveLength(16);
    expect(Buffer.from(m![2], 'base64url')).toHaveLength(64);
  });

  it('matches an independent scrypt computation with the documented parameters', async () => {
    const stored = await hashPassword('independent check');
    const [, , , , salt, hash] = stored.split('$');
    const expected = crypto.scryptSync('independent check', Buffer.from(salt, 'base64url'), 64, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    expect(expected.toString('base64url')).toBe(hash);
  });

  it('uses a fresh random salt each time', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
  });
});

describe('verifyPassword', () => {
  it('is true for the right password and false for a wrong one', async () => {
    const stored = await hashPassword('right password!');
    expect(await verifyPassword('right password!', stored)).toBe(true);
    expect(await verifyPassword('wrong password!', stored)).toBe(false);
    expect(await verifyPassword('Right password!', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('handles unicode passwords', async () => {
    const stored = await hashPassword('pässwörd-🌊-sydney');
    expect(await verifyPassword('pässwörd-🌊-sydney', stored)).toBe(true);
    expect(await verifyPassword('passwörd-🌊-sydney', stored)).toBe(false);
  });

  it('returns false (never throws) for malformed stored hashes', async () => {
    const good = await hashPassword('pw');
    const [, , , , salt, hash] = good.split('$');
    const malformed: unknown[] = [
      '',
      'not a hash',
      'scrypt',
      'scrypt$16384$8$1$',
      `scrypt$16384$8$1$${salt}`,
      `scrypt$16384$8$1$${salt}$`,
      `scrypt$16384$8$1$$${hash}`,
      `bcrypt$16384$8$1$${salt}$${hash}`,
      `scrypt$abc$8$1$${salt}$${hash}`,
      `scrypt$16383$8$1$${salt}$${hash}`, // N not a power of 2
      `scrypt$0$8$1$${salt}$${hash}`,
      `scrypt$-16384$8$1$${salt}$${hash}`,
      `scrypt$1073741824$8$1$${salt}$${hash}`, // absurd N
      `scrypt$16384$0$1$${salt}$${hash}`,
      `scrypt$16384$8$1$${salt}$${hash}$extra`,
      `scrypt$16384$8$1$${salt}$${hash}!!`,
      `scrypt$16384$8$1$sa+lt/==$${hash}`,
      null,
      undefined,
      12345,
    ];
    for (const stored of malformed) {
      await expect(verifyPassword('pw', stored as string)).resolves.toBe(false);
    }
  });

  it('honours the parameters stored in the hash', async () => {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync('legacy', salt, 32, { N: 1024, r: 4, p: 2 });
    const stored = `scrypt$1024$4$2$${salt.toString('base64url')}$${key.toString('base64url')}`;
    expect(await verifyPassword('legacy', stored)).toBe(true);
    expect(await verifyPassword('legacz', stored)).toBe(false);
  });
});

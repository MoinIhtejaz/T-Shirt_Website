// Orchestrator-owned glue. The only module that reads process.env.
// Every variable here is documented in contracts/env.example.
import os from 'node:os';
import path from 'node:path';

export interface AppConfig {
  port: number;
  isProduction: boolean;
  databaseFile: string; // absolute path, or ":memory:"
  uploadDir: string; // absolute path
  sessionTtlHours: number;
  cookieSecure: boolean;
  /** Express "trust proxy" value. Never `true`: that would let any client spoof its IP. */
  trustProxy: false | number | 'loopback' | 'linklocal' | 'uniquelocal';
  /** Showcase only: every write to /api is refused with 403 READ_ONLY. */
  readOnly: boolean;
}

function intFrom(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function trustProxyFrom(value: string | undefined): AppConfig['trustProxy'] {
  const v = value?.trim().toLowerCase();
  if (!v || v === 'false' || v === '0') return false;
  if (v === 'loopback' || v === 'linklocal' || v === 'uniquelocal') return v;
  const n = Number(v);
  if (Number.isInteger(n) && n > 0 && n <= 10) return n;
  throw new Error('TRUST_PROXY must be false, a hop count from 1 to 10, loopback, linklocal or uniquelocal');
}

function resolvePath(value: string): string {
  return value === ':memory:' ? value : path.resolve(value);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: intFrom(env.PORT, 3001, 'PORT'),
    isProduction: env.NODE_ENV === 'production',
    databaseFile: resolvePath(env.DATABASE_FILE || './data/saltline.db'),
    uploadDir: resolvePath(env.UPLOAD_DIR || './uploads'),
    sessionTtlHours: intFrom(env.SESSION_TTL_HOURS, 12, 'SESSION_TTL_HOURS'),
    cookieSecure: env.COOKIE_SECURE === 'true',
    trustProxy: trustProxyFrom(env.TRUST_PROXY),
    readOnly: env.READ_ONLY === 'true',
  };
}

/** Vercel functions have no persistent disk: run read-only from /tmp, over HTTPS. */
export function isVercel(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === '1';
}

export function loadVercelConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const base = path.join(os.tmpdir(), '2a-marketing');
  return loadConfig({
    ...env,
    DATABASE_FILE: path.join(base, 'catalogue.db'),
    UPLOAD_DIR: path.join(base, 'uploads'),
    COOKIE_SECURE: env.COOKIE_SECURE ?? 'true',
    READ_ONLY: 'true',
  });
}

/** Seed-only settings. Kept out of AppConfig so the running server never holds the admin password. */
export function loadSeedAdmin(env: NodeJS.ProcessEnv = process.env): { email: string; password: string } {
  const email = env.ADMIN_EMAIL?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the admin account');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  return { email, password };
}

/** Config for tests: in-memory DB, temp upload dir supplied by the caller. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    isProduction: false,
    databaseFile: ':memory:',
    uploadDir: path.resolve('uploads-test'),
    sessionTtlHours: 12,
    cookieSecure: false,
    trustProxy: false,
    readOnly: false,
    ...overrides,
  };
}

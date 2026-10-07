// In-memory fakes for AdminRepo / SessionRepo plus a tiny app that mounts the auth layer.
// Deliberately does not import src/db (built in parallel).
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { AdminRecord, AdminRepo, SessionRecord, SessionRepo } from '../../contracts/modules';
import type { AdminUser } from '../../contracts/types';
import { SESSION_COOKIE } from '../../contracts/types';
import { testConfig, type AppConfig } from '../../src/shared/config';
import { errorHandler } from '../../src/shared/http';
import { createAuth, hashPassword } from '../../src/auth/index';

export class FakeAdminRepo implements AdminRepo {
  readonly rows: AdminRecord[] = [];
  private nextId = 1;

  getByEmail(email: string): AdminRecord | null {
    const row = this.rows.find((r) => r.email.toLowerCase() === email.toLowerCase());
    return row ? { ...row } : null;
  }

  getById(id: number): AdminUser | null {
    const row = this.rows.find((r) => r.id === id);
    return row ? { id: row.id, email: row.email } : null;
  }

  upsert(email: string, passwordHash: string): AdminUser {
    const existing = this.rows.find((r) => r.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      existing.passwordHash = passwordHash;
      return { id: existing.id, email: existing.email };
    }
    const row: AdminRecord = { id: this.nextId++, email, passwordHash };
    this.rows.push(row);
    return { id: row.id, email: row.email };
  }

  remove(id: number): void {
    const i = this.rows.findIndex((r) => r.id === id);
    if (i >= 0) this.rows.splice(i, 1);
  }
}

export class FakeSessionRepo implements SessionRepo {
  readonly rows = new Map<string, SessionRecord>();

  create(record: SessionRecord): void {
    if (this.rows.has(record.tokenHash)) throw new Error('duplicate token hash');
    this.rows.set(record.tokenHash, { ...record, expiresAt: new Date(record.expiresAt) });
  }

  get(tokenHash: string): SessionRecord | null {
    const row = this.rows.get(tokenHash);
    return row ? { ...row, expiresAt: new Date(row.expiresAt) } : null;
  }

  delete(tokenHash: string): void {
    this.rows.delete(tokenHash);
  }

  deleteExpired(now: Date): number {
    let n = 0;
    for (const [k, v] of this.rows) {
      if (v.expiresAt.getTime() <= now.getTime()) {
        this.rows.delete(k);
        n++;
      }
    }
    return n;
  }
}

export const ADMIN_EMAIL = 'owner@saltline.test';
export const ADMIN_PASSWORD = 'correct-horse-battery';

export interface Harness {
  app: Express;
  admins: FakeAdminRepo;
  sessions: FakeSessionRepo;
  config: AppConfig;
  adminId: number;
}

let cachedHash: string | null = null;

export async function makeHarness(overrides: Partial<AppConfig> = {}): Promise<Harness> {
  cachedHash ??= await hashPassword(ADMIN_PASSWORD);
  const admins = new FakeAdminRepo();
  const sessions = new FakeSessionRepo();
  const { id: adminId } = admins.upsert(ADMIN_EMAIL, cachedHash);
  const config = testConfig(overrides);
  const auth = createAuth({ repos: { admins, sessions }, config });

  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api/auth', auth.router);
  app.get('/api/admin/ping', auth.requireAdmin, (req, res) => {
    res.json({ admin: req.admin });
  });
  app.use(errorHandler);
  return { app, admins, sessions, config, adminId };
}

/** All Set-Cookie headers from a supertest response. */
export function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? (raw as string[]) : [String(raw)];
}

export function sessionSetCookie(res: { headers: Record<string, unknown> }): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
}

/** The raw token value from a Set-Cookie header for the session cookie. */
export function tokenFrom(res: { headers: Record<string, unknown> }): string {
  const c = sessionSetCookie(res);
  if (!c) throw new Error('no session cookie set');
  return decodeURIComponent(c.split(';')[0].slice(SESSION_COOKIE.length + 1));
}

export function cookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}`;
}

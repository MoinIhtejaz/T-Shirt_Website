// AUTH layer. Export surface fixed by contracts/modules.ts#AuthModule.
// Answers "who is calling, and are they an admin?" and nothing more.
import crypto from 'node:crypto';
import { Router, type CookieOptions, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AuthDeps, AuthModule } from '../../contracts/modules';
import { SESSION_COOKIE, type AdminUser, type FieldError, type SessionResponse } from '../../contracts/types';
import { sendError } from '../shared/http';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';

export { hashPassword, verifyPassword };

const TOKEN_BYTES = 32;
const INVALID_CREDENTIALS_MESSAGE = 'Email or password is incorrect.';
const UNAUTHENTICATED_MESSAGE = 'Please sign in.';

const loginSchema = z.object({
  email: z
    .string({ error: 'Email is required.' })
    .trim()
    .min(1, { error: 'Email is required.' })
    .max(254, { error: 'Email must be at most 254 characters.' }),
  password: z
    .string({ error: 'Password is required.' })
    .min(1, { error: 'Password is required.' })
    .max(200, { error: 'Password must be at most 200 characters.' }),
});

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function newToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function readToken(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[SESSION_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join('.') : 'body',
    message: issue.message,
  }));
}

export function createAuth(deps: AuthDeps): { router: Router; requireAdmin: RequestHandler } {
  const { repos, config } = deps;
  const ttlMs = config.sessionTtlHours * 60 * 60 * 1000;

  const baseCookie: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/',
  };

  /** Resolves the session cookie to an admin, deleting expired or orphaned rows. */
  function authenticate(req: Request): AdminUser | null {
    const token = readToken(req);
    if (!token) return null;
    const tokenHash = sha256Hex(token);
    const session = repos.sessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      repos.sessions.delete(tokenHash);
      return null;
    }
    const admin = repos.admins.getById(session.adminId);
    if (!admin) {
      repos.sessions.delete(tokenHash);
      return null;
    }
    return { id: admin.id, email: admin.email };
  }

  const requireAdmin: RequestHandler = (req, res, next) => {
    const admin = authenticate(req);
    if (!admin) {
      sendError(res, 401, 'UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);
      return;
    }
    req.admin = admin;
    next();
  };

  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.post('/login', async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, 'VALIDATION_FAILED', 'Some fields need fixing.', toFieldErrors(parsed.error));
      return;
    }
    const { email, password } = parsed.data;

    const record = repos.admins.getByEmail(email);
    // Always run exactly one scrypt verification, known email or not.
    const ok = await verifyPassword(password, record ? record.passwordHash : DUMMY_HASH);
    if (!record || !ok) {
      sendError(res, 401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
      return;
    }

    // A pre-existing cookie is never reused: login always issues a fresh session.
    const previous = readToken(req);
    if (previous) repos.sessions.delete(sha256Hex(previous));

    const token = newToken();
    repos.sessions.create({
      tokenHash: sha256Hex(token),
      adminId: record.id,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    res.cookie(SESSION_COOKIE, token, { ...baseCookie, maxAge: ttlMs });
    const body: SessionResponse = { user: { id: record.id, email: record.email } };
    res.status(200).json(body);
  });

  router.post('/logout', (req: Request, res: Response) => {
    const token = readToken(req);
    if (token) repos.sessions.delete(sha256Hex(token));
    res.clearCookie(SESSION_COOKIE, baseCookie);
    res.status(204).end();
  });

  router.get('/me', requireAdmin, (req: Request, res: Response) => {
    const body: SessionResponse = { user: req.admin as AdminUser };
    res.status(200).json(body);
  });

  return { router, requireAdmin };
}

// Compile-time check that the export surface matches the contract.
void ({ hashPassword, verifyPassword, createAuth } satisfies AuthModule);

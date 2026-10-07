// Orchestrator-owned composition root. Wires the layers per contracts/modules.ts.
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './shared/config';
import { apiNotFound, errorHandler } from './shared/http';
import { openDatabase, createRepositories } from './db/index';
import { createAuth } from './auth/index';
import { securityHeaders, csrfGuard, rateLimiter, isAllowedAmazonUrl } from './security/index';
import { createApiRouter } from './api/index';

export interface AppHandle {
  app: Express;
  db: DatabaseSync;
}

export function createApp(config: AppConfig): AppHandle {
  const db = openDatabase(config.databaseFile);
  const repos = createRepositories(db);
  repos.sessions.deleteExpired(new Date());
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const auth = createAuth({ repos, config });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders(config));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', csrfGuard());
  app.post('/api/auth/login', rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 }));
  app.use('/api/auth', auth.router);
  app.use('/api', createApiRouter({ repos, requireAdmin: auth.requireAdmin, isAllowedAmazonUrl, config }));
  app.use('/api', apiNotFound);

  // Uploaded and seeded images. Sandboxed so a hostile file can never run script on this origin.
  app.use(
    '/uploads',
    (_req, res, next) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    },
    express.static(config.uploadDir, { index: false, dotfiles: 'deny', maxAge: '7d' }),
    (_req: express.Request, res: express.Response) => {
      res.status(404).end();
    },
  );

  if (config.isProduction) {
    const uiDir = path.resolve('dist/ui');
    app.use(express.static(uiDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(path.join(uiDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return { app, db };
}

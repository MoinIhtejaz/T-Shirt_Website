// Orchestrator-owned entry point for the Vercel function (see scripts/build-vercel.ts).
// Each cold start opens a fresh SQLite file in /tmp and loads the catalogue from catalogue/.
// The site runs read-only there: Vercel keeps no files between instances.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadVercelConfig } from './shared/config';
import { createApp } from './app';
import { seedDatabase } from './db/seed';

const ready = (async () => {
  const config = loadVercelConfig();
  const { app, db } = createApp(config);
  await seedDatabase(db, config.uploadDir, null, async () => {
    throw new Error('No admin account on a read-only deployment');
  });
  return app;
})();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await ready;
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}

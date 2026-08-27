import { resolve } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { registrySource } from './environment.js';
import { isCrossOrigin, hasValidPairingToken } from './pairing.js';
import { cachedRegistry } from './planning.js';
import { registerChangeRoutes } from './routes/changes.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerPublishingRoutes } from './routes/publishing.js';
import { registerRegistryRoutes } from './routes/registry.js';
import { registerSystemRoutes } from './routes/system.js';
import type { ServerOptions } from './types.js';

export function createApp(options: ServerOptions = {}) {
  const app = new Hono();
  const cwd = resolve(options.cwd ?? process.cwd());
  const pairingToken = options.pairingToken;

  if (options.prewarm) {
    void cachedRegistry.get(registrySource(options, cwd)).catch(() => undefined);
  }

  app.get('/health', (context) => context.json({ ok: true }));
  app.use('/api/*', cors({ origin: '*' }));

  app.use('/api/*', async (context, next) => {
    if (context.req.method === 'OPTIONS') return next();

    // SAFETY: same-origin requests and requests to an unprotected server are
    // allowed; only cross-origin callers must prove the pairing token.
    if (!pairingToken || !isCrossOrigin(context.req.raw)) return next();

    if (!hasValidPairingToken(context.req.raw, pairingToken)) {
      return context.json({ error: 'The local API requires a pairing token from `aid web`.' }, 401);
    }

    return next();
  });

  const context = { app, options, cwd };
  registerSystemRoutes(context);
  registerRegistryRoutes(context);
  registerPublishingRoutes(context);
  registerLibraryRoutes(context);
  registerChangeRoutes(context);

  return app;
}

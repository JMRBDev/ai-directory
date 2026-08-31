import { resolve } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createSessionStore } from './auth.js';
import { registrySource } from './environment.js';
import { isCrossOrigin, bearerToken } from './pairing.js';
import { cachedRegistry } from './planning.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerChangeRoutes } from './routes/changes.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerPublishingRoutes } from './routes/publishing.js';
import { registerRegistryRoutes } from './routes/registry.js';
import { registerSystemRoutes } from './routes/system.js';
import type { ServerOptions } from './types.js';

export function createApp(options: ServerOptions = {}) {
  const app = new Hono();
  const cwd = resolve(options.cwd ?? process.cwd());
  const pairingTokens = options.pairingTokens;
  const authEnabled = pairingTokens !== undefined && pairingTokens.length > 0;
  const sessions = createSessionStore(pairingTokens ?? []);

  if (options.prewarm) {
    void cachedRegistry.get(registrySource(options, cwd)).catch(() => undefined);
  }

  app.get('/health', (context) => context.json({ ok: true }));
  app.use('/api/*', cors({ origin: '*' }));

  registerAuthRoutes({ app, options, cwd }, sessions);

  app.use('/api/*', async (context, next) => {
    if (context.req.method === 'OPTIONS') return next();

    // SAFETY: same-origin requests and requests to an unprotected server are
    // allowed; only cross-origin callers must present a valid session.
    if (!authEnabled || !isCrossOrigin(context.req.raw)) return next();

    const presented = bearerToken(context.req.raw);
    if (presented === null) {
      return context.json({ error: 'The local API requires a session token. Connect from Settings first.' }, 401);
    }

    // The pairing token is a one-time bootstrap credential. It only authorizes
    // POST /api/auth/sessions and is never accepted as a session token.
    if (!sessions.verifySessionToken(presented)) {
      return context.json({ error: 'The presented token is not a valid session. Connect from Settings first.' }, 401);
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

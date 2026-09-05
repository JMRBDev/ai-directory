import { resolve } from 'node:path';
import { Hono } from 'hono';
import { registrySource } from './environment.js';
import { cachedRegistry } from './planning.js';
import { registerChangeRoutes } from './routes/changes.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerRegistryRoutes } from './routes/registry.js';
import { registerSystemRoutes } from './routes/system.js';
import type { ServerOptions } from './types.js';

export function createApp(options: ServerOptions = {}) {
  // The website is always served by `aid web` from the same origin, so the
  // API trusts local callers directly. There is no hosted frontend, no CORS,
  // and no token handshake.
  const app = new Hono();
  const cwd = resolve(options.cwd ?? process.cwd());

  if (options.prewarm) {
    let source;
    try {
      source = registrySource(options, cwd);
    } catch {
      // No registry source is configured yet; the server still starts so the
      // website can guide setup. Registry reads resolve per request.
    }
    if (source) void cachedRegistry.get(source).catch(() => undefined);
  }

  app.get('/health', (context) => context.json({ ok: true, version: options.version ?? null }));

  const context = { app, options, cwd };
  registerSystemRoutes(context);
  registerRegistryRoutes(context);
  registerLibraryRoutes(context);
  registerChangeRoutes(context);

  return app;
}

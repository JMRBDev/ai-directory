import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  clearConfigFile,
  getConfigPath,
  getRepositorySetting,
  readConfigFile,
  writeConfigFile,
  type ConfigScope,
} from '@ai-directory/config';

export type ServerOptions = {
  cwd?: string;
};

type ConfigRequest = {
  repository?: unknown;
  scope?: unknown;
};

function isConfigScope(value: unknown): value is ConfigScope {
  return value === 'user' || value === 'project';
}

function configResponse(cwd: string) {
  const setting = getRepositorySetting(undefined, cwd);

  return {
    repository: setting.value ?? null,
    source: setting.source,
  };
}

export function createApp(options: ServerOptions = {}) {
  const app = new Hono();
  const cwd = options.cwd ?? '.';

  app.get('/health', (context) => context.json({ ok: true }));
  app.use('/api/*', cors({ origin: '*' }));

  app.get('/api/config', (context) => context.json(configResponse(cwd)));

  app.put('/api/config', async (context) => {
    let body: unknown;

    try {
      body = await context.req.json<unknown>();
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return context.json({ error: 'Request body must be a JSON object.' }, 400);
    }

    const request = body as ConfigRequest;

    if (typeof request.repository !== 'string' || !request.repository.trim()) {
      return context.json({ error: 'repository must be a non-empty string.' }, 400);
    }

    if (!isConfigScope(request.scope)) {
      return context.json({ error: 'scope must be user or project.' }, 400);
    }

    const path = getConfigPath(request.scope, cwd);
    const current = readConfigFile(path);
    await writeConfigFile(path, { ...current, repository: request.repository.trim() });

    return context.json({ ...configResponse(cwd), savedScope: request.scope });
  });

  app.delete('/api/config', async (context) => {
    const scope = context.req.query('scope');

    if (!isConfigScope(scope)) {
      return context.json({ error: 'scope must be user or project.' }, 400);
    }

    await clearConfigFile(getConfigPath(scope, cwd));
    return context.json({ ...configResponse(cwd), clearedScope: scope });
  });

  return app;
}

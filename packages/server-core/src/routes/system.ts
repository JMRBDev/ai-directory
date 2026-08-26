import {
  clearConfigFile,
  getConfigPath,
  readConfigFile,
  writeConfigFile,
} from '@ai-directory/config';
import { detectHarnesses, errorMessage } from '@ai-directory/installers';
import { configResponse, githubUsername } from '../environment.js';
import { jsonBody } from '../http.js';
import { cachedRegistry } from '../planning.js';
import { configRequestSchema, configScopeSchema } from '../requests.js';
import type { RequestBody, RouteContext } from '../types.js';

export function registerSystemRoutes({ app, options, cwd }: RouteContext): void {
  app.get('/api/harnesses', async (context) => {
    try {
      const detectionOptions: Parameters<typeof detectHarnesses>[0] = { cwd };
      if (options.homeDirectory) detectionOptions.homeDirectory = options.homeDirectory;
      if (options.environment) detectionOptions.environment = options.environment;

      return context.json({ harnesses: await detectHarnesses(detectionOptions) });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });

  app.post('/api/refresh', async (context) => {
    try {
      await cachedRegistry.refresh();
      return context.json({ ok: true });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });

  app.get('/api/github-user', async (context) => {
    try {
      return context.json({ username: await githubUsername(options, cwd) });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 503);
    }
  });

  app.get('/api/config', (context) => context.json(configResponse(cwd)));

  app.put('/api/config', async (context) => {
    let body: RequestBody;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const result = configRequestSchema.safeParse(body);

    if (!result.success) {
      const issue = result.error.issues[0];
      const error = issue?.path[0] === 'repository'
        ? 'repository must be a non-empty string.'
        : issue?.path[0] === 'scope'
          ? 'scope must be user or project.'
          : 'Request body must be a JSON object.';
      return context.json({ error }, 400);
    }

    const request = result.data;
    const path = getConfigPath(request.scope, cwd);
    const current = readConfigFile(path);
    await writeConfigFile(path, { ...current, repository: request.repository });

    return context.json({ ...configResponse(cwd), savedScope: request.scope });
  });

  app.delete('/api/config', async (context) => {
    const scopeResult = configScopeSchema.safeParse(context.req.query('scope'));

    if (!scopeResult.success) {
      return context.json({ error: 'scope must be user or project.' }, 400);
    }

    const scope = scopeResult.data;
    await clearConfigFile(getConfigPath(scope, cwd));
    return context.json({ ...configResponse(cwd), clearedScope: scope });
  });
}

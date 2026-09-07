import { addRegistryEntry, normalizeRegistryId, removeRegistryEntry } from '@ai-directory/config';
import { errorMessage } from '@ai-directory/installers';
import { assertSafeRepositoryUrl, readRemoteRegistryIndex } from '@ai-directory/registry';
import { configResponse } from '../environment.js';
import { jsonBody } from '../http.js';
import type { RouteContext } from '../types.js';

export function registerRegistryManagementRoutes({ app, cwd }: RouteContext): void {
  app.get('/api/registries', (context) => {
    try {
      return context.json({ registries: configResponse(cwd).registries });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });

  app.post('/api/registries', async (context) => {
    let body: unknown;
    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }
    const record = body as { id?: unknown; url?: unknown; branch?: unknown; scope?: unknown };
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    const branch = typeof record.branch === 'string' && record.branch.trim() ? record.branch.trim() : undefined;
    const scope = record.scope === 'project' ? 'project' : 'user';
    if (!id) return context.json({ error: 'id must be a lowercase slug, for example company.' }, 400);
    if (!url) return context.json({ error: 'url must be a non-empty string.' }, 400);
    try {
      normalizeRegistryId(id);
      assertSafeRepositoryUrl(url);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }

    try {
      await readRemoteRegistryIndex({ repositoryUrl: url, baseBranch: branch ?? 'main' });
    } catch (caught) {
      return context.json({ error: `Could not read registry ${id}: ${errorMessage(caught)}` }, 400);
    }

    try {
      const entry = branch ? { id, url, branch } : { id, url };
      await addRegistryEntry(entry, scope, cwd);
      return context.json({ registries: configResponse(cwd).registries, savedScope: scope });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.delete('/api/registries', async (context) => {
    const id = context.req.query('id')?.trim();
    const scopeParam = context.req.query('scope');
    if (!id) return context.json({ error: 'id must be a non-empty string.' }, 400);
    if (scopeParam && scopeParam !== 'user' && scopeParam !== 'project') {
      return context.json({ error: 'scope must be user or project.' }, 400);
    }
    try {
      const scope = scopeParam === 'user' || scopeParam === 'project' ? scopeParam : undefined;
      const result = await removeRegistryEntry(normalizeRegistryId(id), scope, cwd);
      if (!result.removed) return context.json({ error: `Registry is not configured: ${id}.` }, 404);
      return context.json({ registries: configResponse(cwd).registries, clearedScopes: result.scopes });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });
}

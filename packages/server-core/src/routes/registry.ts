import { errorMessage } from '@ai-directory/installers';
import { registrySource } from '../environment.js';
import { withRegistrySnapshot, type RegistryApiResponse } from '../planning.js';
import type { RouteContext } from '../types.js';

export function registerRegistryRoutes({ app, options, cwd }: RouteContext): void {
  app.get('/api/registry', async (context) => {
    let source;
    try {
      source = registrySource(options, cwd);
    } catch (caught) {
      return context.json({
        index: null,
        source: 'none',
        error: errorMessage(caught),
      });
    }

    try {
      const index = await withRegistrySnapshot(options, cwd, (snapshot) => snapshot.readIndex());
      const response: RegistryApiResponse = {
        index,
        source: source.type,
      };
      if (source.type === 'remote') response.repository = source.repositoryUrl;
      return context.json(response);
    } catch (caught) {
      const response: RegistryApiResponse = {
        index: null,
        source: source.type,
        error: errorMessage(caught),
      };
      if (source.type === 'remote') response.repository = source.repositoryUrl;
      return context.json(response);
    }
  });

  app.get('/api/registry/resource/:owner/:type/:name', async (context) => {
    const resourceId = [
      context.req.param('owner'),
      context.req.param('type'),
      context.req.param('name'),
    ].join('/');

    try {
      const result = await withRegistrySnapshot(options, cwd, async (snapshot) => {
        const index = await snapshot.readIndex();
        const resource = index.resources.find((candidate) =>
          `${candidate.owner}/${candidate.type}/${candidate.name}` === resourceId,
        );
        if (!resource) throw new Error(`Resource not found: ${resourceId}`);
        try {
          const version = await snapshot.readResource(resourceId, resource.latestVersion);
          return { resource, version: version.resource };
        } catch (caught) {
          return { resource, version: null, error: errorMessage(caught) };
        }
      });
      return context.json(result);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 404);
    }
  });
}

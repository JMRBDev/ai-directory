import { errorMessage } from '@ai-directory/installers';
import { aggregatedRegistry, withRegistrySnapshot, type RegistryApiResponse } from '../planning.js';
import { registryEndpointFor } from '../environment.js';
import type { RouteContext } from '../types.js';

export function registerRegistryRoutes({ app, options, cwd }: RouteContext): void {
  app.get('/api/registry', async (context) => {
    try {
      const aggregated = await aggregatedRegistry(options, cwd);
      if (aggregated.registries.length === 0) {
        return context.json({
          index: null,
          source: 'none',
          registries: [],
          error: 'No registry source configured. Run `aid setup` or pass `--index <path>`.',
        });
      }
      const index = {
        schemaVersion: 1 as const,
        resources: aggregated.entries.map((entry) => entry.primary.summary),
      };
      const response: RegistryApiResponse & {
        registries: typeof aggregated.registries;
        sources: Record<string, typeof aggregated.entries[number]['entries']>;
        errors: typeof aggregated.errors;
      } = {
        index,
        source: 'remote',
        registries: aggregated.registries,
        sources: Object.fromEntries(
          aggregated.entries.map((entry) => [entry.resource, entry.entries]),
        ),
        errors: aggregated.errors,
      };
      const first = aggregated.registries[0];
      if (first?.url) response.repository = first.url;
      if (aggregated.errors.length > 0) {
        response.error = aggregated.errors.map((entry) => `${entry.registry.id}: ${entry.error}`).join('; ');
      }
      return context.json(response);
    } catch (caught) {
      return context.json({
        index: null,
        source: 'none',
        registries: [],
        error: errorMessage(caught),
      });
    }
  });

  app.get('/api/registry/resource/:owner/:type/:name', async (context) => {
    const resourceId = [
      context.req.param('owner'),
      context.req.param('type'),
      context.req.param('name'),
    ].join('/');
    const registryId = context.req.query('registry');

    try {
      const endpoint = registryEndpointFor(options, cwd, registryId);
      const result = await withRegistrySnapshot(options, cwd, async (snapshot) => {
        const index = await snapshot.readIndex();
        const resource = index.resources.find((candidate) =>
          `${candidate.owner}/${candidate.type}/${candidate.name}` === resourceId,
        );
        if (!resource) throw new Error(`Resource not found: ${resourceId}`);
        try {
          const version = await snapshot.readResource(resourceId, resource.latestVersion);
          return { resource, version: version.resource, registry: endpoint.id };
        } catch (caught) {
          return { resource, version: null, registry: endpoint.id, error: errorMessage(caught) };
        }
      }, endpoint.id);
      return context.json(result);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 404);
    }
  });
}

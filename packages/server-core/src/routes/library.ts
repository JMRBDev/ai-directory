import { homedir } from 'node:os';
import { discoverLocalResources, enrichLocalResources, errorMessage } from '@ai-directory/installers';
import type { LocalResource, ResourceDiscoveryOptions } from '@ai-directory/installers';
import { registrySource } from '../environment.js';
import { localResourceFromMcpRecord, readInstallationRecords } from '../installations.js';
import { cachedRegistry } from '../planning.js';
import type { RouteContext } from '../types.js';

export function registerLibraryRoutes({ app, options, cwd }: RouteContext): void {
  app.get('/api/installed', async (context) => {
    const installations = await readInstallationRecords(options.homeDirectory, cwd);

    return context.json({ installations });
  });

  app.get('/api/local-resources', async (context) => {
    try {
      const records = await readInstallationRecords(options.homeDirectory, cwd);
      const discoveryOptions: ResourceDiscoveryOptions = {
        cwd,
        records,
      };
      if (options.homeDirectory) discoveryOptions.homeDirectory = options.homeDirectory;
      if (options.environment) discoveryOptions.environment = options.environment;
      const resources = await discoverLocalResources(discoveryOptions);
      const mcpResources = records
        .filter((record) => record.kind === 'mcp')
        .map(localResourceFromMcpRecord);
      const merged = [...resources, ...mcpResources];

      let registryError: string | undefined;
      let enriched = merged;

      if (merged.some((resource) => resource.resource)) {
        try {
          const snapshot = await cachedRegistry.get(registrySource(options, cwd));
          enriched = enrichLocalResources(merged, await snapshot.readIndex());
        } catch (caught) {
          registryError = errorMessage(caught);
        }
      }

      interface LocalResourcesResponse {
        resources: LocalResource[];
        registryError?: string;
        homeDirectory?: string;
      }

      const response: LocalResourcesResponse = { resources: enriched };
      if (registryError) response.registryError = registryError;
      response.homeDirectory = options.homeDirectory ?? homedir();

      return context.json(response);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });
}

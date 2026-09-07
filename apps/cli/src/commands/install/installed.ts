import { defineCommand } from 'citty';
import { normalizeResourceDirectoryPath, readResourceDirectories } from '@ai-directory/config';
import { discoverLocalResources, enrichLocalResources, type ExtraResourceDirectory } from '@ai-directory/installers';
import { localResourceFromMcpRecord, readInstallationRecords } from '@ai-directory/server-core';
import { aggregatedRegistries, reportError } from '../../helpers';

export const installed = defineCommand({
  meta: {
    name: 'installed',
    description: 'Discover local resources and their installation state',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Print JSON instead of a table',
    },
  },
  async run({ args }) {
    try {
      const records = (await readInstallationRecords())
        .sort((left, right) => left.resource.localeCompare(right.resource));
      const resourceDirectories: ExtraResourceDirectory[] = readResourceDirectories().map((entry) => ({
        path: normalizeResourceDirectoryPath(entry.path),
      }));
      let resources = await discoverLocalResources({ records, resourceDirectories });
      const mcpResources = records
        .filter((record) => record.kind === 'mcp')
        .map(localResourceFromMcpRecord);
      resources = [...resources, ...mcpResources];

      try {
        const aggregated = await aggregatedRegistries();
        resources = enrichLocalResources(resources, {
          schemaVersion: 1,
          resources: aggregated.entries.map((entry) => entry.primary.summary),
        });
      } catch {
        // Local discovery remains useful when the registry is unavailable.
      }

      if (args.json) {
        console.log(JSON.stringify(resources, null, 2));
        return;
      }

      if (resources.length === 0) {
        console.log('No local resources found.');
        return;
      }

      for (const resource of resources) {
        const id = resource.resource ?? `local/${resource.type}/${resource.name}`;
        const version = resource.version ? `v${resource.version}` : '-';
        const origin = resource.source === 'custom' ? `custom:${resource.sourcePath ?? ''}` : 'harness';
        console.log(
          `${id}\t${resource.state}\t${resource.registryState}\t${resource.harness}\t${version}\t${resource.path}\t${origin}`,
        );
      }
    } catch (error) {
      reportError(error);
    }
  },
});

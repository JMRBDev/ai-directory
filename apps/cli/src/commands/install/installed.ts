import { defineCommand } from 'citty';
import { discoverLocalResources, enrichLocalResources } from '@ai-directory/installers';
import { localResourceFromMcpRecord, readInstallationRecords } from '@ai-directory/server-core';
import { readRegistrySourceIndex } from '@ai-directory/registry';
import { getRegistrySource, reportError } from '../../helpers';

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
      let resources = await discoverLocalResources({ records });
      const mcpResources = records
        .filter((record) => record.kind === 'mcp')
        .map(localResourceFromMcpRecord);
      resources = [...resources, ...mcpResources];

      try {
        resources = enrichLocalResources(
          resources,
          await readRegistrySourceIndex(getRegistrySource()),
        );
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
        console.log(
          `${id}\t${resource.state}\t${resource.registryState}\t${resource.harness}\t${version}\t${resource.path}`,
        );
      }
    } catch (error) {
      reportError(error);
    }
  },
});

import { defineCommand } from 'citty';
import { resourceKey, type Harness } from '@ai-directory/contracts';
import {
  applyMcpOperations,
  applyResourceOperations,
  assertInstalledFor,
  readInstallationManifest,
  type ResourceOperation,
} from '@ai-directory/installers';
import {
  installManifestPath,
  installationResourceIds,
  isMcpResource,
  readInstallationPacks,
  readInstallationRecords,
} from '@ai-directory/server-core';
import { readRegistrySourceResource } from '@ai-directory/registry';
import {
  getRegistrySource,
  hasHarnessArgument,
  isInteractiveTerminal,
  parseHarnesses,
  parseScope,
  reportError,
  withInteractiveForce,
} from '../../helpers';
import { promptInstalledHarnesses, promptInstalledResource } from '../../prompts';
import { ensureToolDependencies } from './shared';

export const update = defineCommand({
  meta: {
    name: 'update',
    description: 'Update an installed resource to the latest or a requested version',
  },
  args: {
    resource: {
      type: 'positional',
      default: '',
      description: 'Resource ID: owner/type/name',
    },
    harness: {
      type: 'string',
      default: 'claude-code',
      valueHint: 'harness[,harness...]',
      description: 'Harnesses to update; repeat or separate with commas',
    },
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path; overrides the configured Git repository',
    },
    version: {
      type: 'string',
      alias: 'v',
      description: 'Version to update to; defaults to the latest version',
    },
    repository: {
      type: 'string',
      description: 'Git repository URL; uses a temporary sparse checkout',
    },
    base: {
      type: 'string',
      default: 'main',
      description: 'Production branch to read from',
    },
    force: {
      type: 'boolean',
      description: 'Continue when managed files were modified',
    },
    'install-dependencies': {
      type: 'boolean',
      description: 'Install missing tool dependencies with a supported package manager',
    },
    scope: {
      type: 'string',
      default: 'user',
      description: 'Install scope for MCP servers: user or project',
    },
  },
  async run({ args, rawArgs }) {
    try {
      const interactiveTerminal = isInteractiveTerminal();
      const resourceArgument = args.resource.trim();
      const explicitHarnesses = hasHarnessArgument(rawArgs);
      const source = getRegistrySource(args.index, args.repository, args.base);
      const installedRecords = interactiveTerminal && (!resourceArgument || !explicitHarnesses)
        ? await readInstallationRecords()
        : [];
      const installedPacks = interactiveTerminal && (!resourceArgument || !explicitHarnesses)
        ? await readInstallationPacks()
        : [];
      const initialManifest = resourceArgument && !isMcpResource(resourceArgument)
        ? await readInstallationManifest(installManifestPath('user'))
        : undefined;
      const choice = resourceArgument
        ? {
            resource: resourceArgument,
            resources: await installationResourceIds(resourceArgument, source, initialManifest),
          }
        : (
            interactiveTerminal
              ? await promptInstalledResource(installedRecords, source, installedPacks)
              : undefined
          );
      if (!choice) throw new Error('Resource ID is required. Pass it as the positional argument.');
      const resource = choice.resource;
      const resourceIds = choice.resources;
      const scope = isMcpResource(resource) ? parseScope(args.scope) : 'user';
      const harnesses = explicitHarnesses
        ? parseHarnesses(args.harness, rawArgs)
        : interactiveTerminal
          ? await promptInstalledHarnesses(installedRecords, resourceIds, installedPacks, resource)
          : parseHarnesses(args.harness, rawArgs);

      if (!harnesses) throw new Error('Select at least one harness.');

      const interactive = interactiveTerminal && (!resourceArgument || !explicitHarnesses);
      const updatedHarnesses = await withInteractiveForce(
        interactive,
        args.force ?? false,
        async (force) => {
          const manifestPath = installManifestPath(isMcpResource(resource) ? scope : 'user');
          const manifest = await readInstallationManifest(manifestPath);
          const loaded = await readRegistrySourceResource(source, resource, args.version);
          const installDependencies = await ensureToolDependencies(
            loaded.resources,
            isInteractiveTerminal(),
            args['install-dependencies'] ?? false,
          );
          const existing = harnesses.map((harness) =>
            loaded.resources.map((entry) =>
              manifest.installations.find(
                (record) =>
                  record.resource === resourceKey(entry.resource) &&
                  record.harness === harness,
              ),
            ),
          );

          assertInstalledFor(manifest, loaded.resources.map((entry) => resourceKey(entry.resource)), harnesses, resource);

          const changed: Harness[] = [];

          for (const [index, harness] of harnesses.entries()) {
            const installedRecords = existing[index] ?? [];

            if (loaded.resources.every((entry, resourceIndex) =>
              entry.version === installedRecords[resourceIndex]?.version,
            )) {
              const target = args.version === undefined
                ? `the latest version (${loaded.resource.version})`
                : `version ${loaded.resource.version}`;
              console.log(`${resource} is already at ${target} for ${harness}.`);
              continue;
            }
            changed.push(harness);
          }

          if (isMcpResource(resource)) {
            const applied = await applyMcpOperations(
              [{
                resource,
                harnesses: changed,
                action: 'install',
                resources: loaded.resources,
                warningResources: [loaded.resource, ...loaded.resources],
                scope,
                version: loaded.resource.version,
              }],
              { cwd: process.cwd() },
              force,
            );
            return { applied, changed, version: loaded.resource.version, mcp: true };
          }

          const operation: ResourceOperation = {
            resource,
            harnesses: changed,
            action: 'install',
            resources: loaded.resources,
            warningResources: [loaded.resource, ...loaded.resources],
            version: loaded.resource.version,
          };
          if (loaded.resource.resource.type === 'templates') {
            operation.pack = {
              version: loaded.resource.version,
              resources: loaded.resources.map((entry) => ({
                resource: resourceKey(entry.resource),
                version: entry.version,
              })),
            };
          }

          const applied = await applyResourceOperations(
            [operation],
            { cwd: process.cwd(), installDependencies },
            force,
          );

          return { applied, changed, version: loaded.resource.version, mcp: false };
        },
      );

      if (!updatedHarnesses) return;
      if (updatedHarnesses.mcp) {
        for (const warning of updatedHarnesses.applied.warnings) {
          console.warn(`Note: ${warning}`);
        }
      } else {
        for (const warning of updatedHarnesses.applied.warnings) {
          console.warn(`Warning: ${warning} has not been reviewed.`);
        }
      }
      for (const note of updatedHarnesses.applied.plan.projectionNotes ?? []) {
        console.log(`Note: ${note}`);
      }
      if (updatedHarnesses.changed.length > 0) {
        console.log(
          `Updated ${resource} to ${updatedHarnesses.version} for ${updatedHarnesses.changed.join(', ')}.`,
        );
      }
    } catch (error) {
      reportError(error);
    }
  },
});

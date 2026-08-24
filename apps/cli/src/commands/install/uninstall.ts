import { defineCommand } from 'citty';
import {
  applyMcpOperations,
  applyResourceOperations,
  assertInstalledFor,
  planResourceOperations,
  readInstallationManifest,
  type ResourceOperation,
} from '@ai-directory/installers';
import {
  installManifestPath,
  installationPackOperation,
  installationResourceIds,
  isMcpResource,
  readInstallationPacks,
  readInstallationRecords,
} from '@ai-directory/server-core';
import {
  getRegistrySource,
  hasHarnessArgument,
  isInteractiveTerminal,
  parseHarnesses,
  parseScope,
  reportError,
  withInteractiveForce,
} from '../../helpers';
import {
  promptInstalledHarnesses,
  promptInstalledResource,
  promptToolDependencyRemoval,
} from '../../prompts';

export const uninstall = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Remove an installed resource',
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
      description: 'Harnesses to uninstall from; repeat or separate with commas',
    },
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path for template resources',
    },
    repository: {
      type: 'string',
      description: 'Git repository URL for template resources',
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
    'remove-dependencies': {
      type: 'boolean',
      description: 'Remove unused tool dependencies installed by AI Directory',
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
      const source = (() => {
        try {
          return getRegistrySource(args.index, args.repository, args.base);
        } catch {
          return undefined;
        }
      })();
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
      const result = await withInteractiveForce(
        interactive,
        args.force ?? false,
        async (force) => {
          const manifestPath = installManifestPath(isMcpResource(resource) ? scope : 'user');
          const manifest = await readInstallationManifest(manifestPath);

          if (isMcpResource(resource)) {
            assertInstalledFor(manifest, resourceIds, harnesses, resource);
            return applyMcpOperations(
              [{
                resource,
                harnesses,
                action: 'uninstall',
                resourceIds,
                scope,
              }],
              { cwd: process.cwd() },
              force,
            );
          }

          const operations: ResourceOperation[] = [];
          for (const harness of harnesses) {
            const installedResourceIds = await installationResourceIds(
              resource,
              source,
              manifest,
              [harness],
            );
            assertInstalledFor(manifest, installedResourceIds, [harness], resource);
            const operation: ResourceOperation = {
              resource,
              harnesses: [harness],
              action: 'uninstall',
              resourceIds: installedResourceIds,
            };
            const pack = installationPackOperation(manifest, resource, harness);
            if (pack) operation.pack = pack;
            operations.push(operation);
          }

          const plan = await planResourceOperations(operations, { cwd: process.cwd() }, force);
          let removeDependencies = args['remove-dependencies'] ?? false;
          if (plan.dependencyRemovals.length > 0 && interactiveTerminal && !removeDependencies) {
            removeDependencies = await promptToolDependencyRemoval(plan.dependencyRemovals) ?? false;
          }

          return applyResourceOperations(
            operations,
            { cwd: process.cwd(), removeDependencies },
            force,
            plan,
          );
        },
      );

      if (!result) return;
      console.log(`Uninstalled ${resource} for ${harnesses.join(', ')}.`);
      for (const dependency of 'removedDependencies' in result ? result.removedDependencies : []) {
        console.log(`Removed unused dependency ${dependency.candidate.command}.`);
      }
      console.log(`Tracked in: ${installManifestPath(isMcpResource(resource) ? scope : 'user')}`);
    } catch (error) {
      reportError(error);
    }
  },
});

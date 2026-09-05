import { defineCommand } from 'citty';
import {
  applyMcpOperations,
  applyResourceOperations,
  assertInstalledFor,
  planResourceOperations,
  readInstallationManifest,
} from '@ai-directory/installers';
import {
  installationResourceIds,
  installManifestPath,
  isMcpResource,
  makeFileUninstallOperations,
} from '@ai-directory/server-core';
import {
  getRegistrySource,
  isInteractiveTerminal,
  reportError,
  withInteractiveForce,
} from '../../helpers';
import { promptToolDependencyRemoval } from '../../prompts';
import { resolveInstalledTarget } from './shared';

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
      const source = (() => {
        try {
          return getRegistrySource(args.index, args.repository, args.base);
        } catch {
          return undefined;
        }
      })();
      const target = await resolveInstalledTarget(
        resourceArgument,
        args.scope,
        args.harness,
        rawArgs,
        source,
      );
      const resource = target.resource;
      const resourceIds = target.resourceIds;
      const scope = target.scope;
      const harnesses = target.harnesses;
      const interactive = target.interactive;
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

          const operations = await makeFileUninstallOperations(
            resource,
            harnesses,
            (id, harness) => installationResourceIds(id, source, manifest, [harness]),
            manifest,
          );

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

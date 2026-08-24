import { defineCommand } from 'citty';
import { resourceKey } from '@ai-directory/contracts';
import {
  applyMcpOperations,
  applyResourceOperations,
  type McpOperation,
  type ResourceOperation,
} from '@ai-directory/installers';
import { installManifestPath, isMcpResource } from '@ai-directory/server-core';
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
import { promptHarnesses, promptResource } from '../../prompts';
import { ensureToolDependencies } from './shared';

export const install = defineCommand({
  meta: {
    name: 'install',
    description: 'Install a resource for one or more coding harnesses',
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
      description: 'Harnesses to install for; repeat or separate with commas',
    },
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path; overrides the configured Git repository',
    },
    version: {
      type: 'string',
      alias: 'v',
      description: 'Version to install; defaults to the latest version',
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
      description: 'Overwrite files already installed at the destination',
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
      const source = getRegistrySource(args.index, args.repository, args.base);
      const resourceArgument = args.resource.trim();
      const resource = resourceArgument || (
        interactiveTerminal ? await promptResource(source) : undefined
      );
      if (!resource) throw new Error('Resource ID is required. Pass it as the positional argument.');
      const explicitHarnesses = hasHarnessArgument(rawArgs);
      const harnesses = explicitHarnesses
        ? parseHarnesses(args.harness, rawArgs)
        : interactiveTerminal
          ? await promptHarnesses()
          : parseHarnesses(args.harness, rawArgs);

      if (!harnesses) throw new Error('Select at least one harness.');

      const loaded = await readRegistrySourceResource(source, resource, args.version);
      const result = loaded.resource;

      const resources = loaded.resources;
      const scope = isMcpResource(resource) ? parseScope(args.scope) : 'user';

      for (const resource of [result, ...resources]) {
        if (resource.resource.reviewStatus === 'unreviewed') {
          console.warn(
            `Warning: ${resourceKey(resource.resource)}@${resource.version} has not been reviewed.`,
          );
        }
      }

      const installDependencies = await ensureToolDependencies(
        [result, ...resources],
        isInteractiveTerminal(),
        args['install-dependencies'] ?? false,
      );

      const manifestPath = installManifestPath(isMcpResource(resource) ? scope : 'user');
      const interactive = interactiveTerminal && (!resourceArgument || !explicitHarnesses);

      const applied = await withInteractiveForce(
        interactive,
        args.force ?? false,
        async (force) => {
          if (isMcpResource(resource)) {
            const operation: McpOperation = {
              resource,
              harnesses,
              action: 'install',
              resources,
              warningResources: [result, ...resources],
              scope,
            };
            if (args.version !== undefined) operation.version = args.version;

            return applyMcpOperations(
              [operation],
              { cwd: process.cwd() },
              force,
            );
          }

          const operation: ResourceOperation = {
            resource,
            harnesses,
            action: 'install',
            resources,
            warningResources: [result, ...resources],
          };
          if (args.version !== undefined) operation.version = args.version;
          if (result.resource.type === 'templates') {
            operation.pack = {
              version: result.version,
              resources: resources.map((entry) => ({
                resource: resourceKey(entry.resource),
                version: entry.version,
              })),
            };
          }

          return applyResourceOperations(
            [operation],
            { cwd: process.cwd(), installDependencies },
            force,
          );
        },
      );

      if (!applied) return;

      for (const installation of applied.installed) {
        console.log(
          `Location: ${installation.destination} (${installation.resource}@${installation.version}, ${installation.harness})`,
        );
        console.log(`Files: ${installation.files.join(', ')}`);
      }
      for (const dependency of 'dependencies' in applied ? applied.dependencies : []) {
        console.log(
          `Installed ${dependency.status.runtime.command} with ${dependency.command} ${dependency.args.join(' ')} (version ${dependency.status.version ?? 'unknown'}).`,
        );
      }
      for (const note of applied.plan.projectionNotes ?? []) {
        console.log(`Note: ${note}`);
      }
      for (const warning of applied.warnings) {
        console.warn(`Note: ${warning}`);
      }

      if (result.resource.type === 'templates') {
        console.log(
          `Installed ${resourceKey(result.resource)}@${result.version} with ${resources.length} resource(s) for ${harnesses.join(', ')}.`,
        );
      } else {
        console.log(
          `Installed ${resourceKey(result.resource)}@${result.version} for ${harnesses.join(', ')}.`,
        );
      }
      console.log(`Tracked in: ${manifestPath}`);
    } catch (error) {
      reportError(error);
    }
  },
});

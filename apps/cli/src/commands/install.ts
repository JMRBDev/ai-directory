import { defineCommand } from 'citty';
import { resourceKey, type Harness } from '@ai-directory/contracts';
import {
  applyMcpOperations,
  applyResourceOperations,
  assertInstalledFor,
  discoverLocalResources,
  enrichLocalResources,
  dependencyStatusMessage,
  inspectToolDependencies,
  planResourceOperations,
  readInstallationManifest,
  type McpOperation,
  type ResourceOperation,
} from '@ai-directory/installers';
import {
  installManifestPath,
  installationResourceIds,
  isMcpResource,
  localResourceFromMcpRecord,
  readInstallationRecords,
} from '@ai-directory/server-core';
import {
  readRegistrySourceIndex,
  readRegistrySourceResource,
  type ResourceVersion,
} from '@ai-directory/registry';
import {
  getRegistrySource,
  hasHarnessArgument,
  isInteractiveTerminal,
  parseHarnesses,
  parseScope,
  reportError,
  withInteractiveForce,
} from '../helpers';
import {
  promptHarnesses,
  promptInstalledHarnesses,
  promptInstalledResource,
  promptResource,
  promptToolDependencyInstall,
  promptToolDependencyRemoval,
} from '../prompts';

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

export const update = defineCommand({
  meta: {
    name: 'update',
    description: 'Update an installed resource to its latest version',
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
      const choice = resourceArgument
        ? {
            resource: resourceArgument,
            resources: await installationResourceIds(resourceArgument, source),
          }
        : (
            interactiveTerminal
              ? await promptInstalledResource(installedRecords, source)
              : undefined
          );
      if (!choice) throw new Error('Resource ID is required. Pass it as the positional argument.');
      const resource = choice.resource;
      const resourceIds = choice.resources;
      const scope = isMcpResource(resource) ? parseScope(args.scope) : 'user';
      const harnesses = explicitHarnesses
        ? parseHarnesses(args.harness, rawArgs)
        : interactiveTerminal
          ? await promptInstalledHarnesses(installedRecords, resourceIds)
          : parseHarnesses(args.harness, rawArgs);

      if (!harnesses) throw new Error('Select at least one harness.');

      const interactive = interactiveTerminal && (!resourceArgument || !explicitHarnesses);
      const updatedHarnesses = await withInteractiveForce(
        interactive,
        args.force ?? false,
        async (force) => {
          const manifestPath = installManifestPath(isMcpResource(resource) ? scope : 'user');
          const manifest = await readInstallationManifest(manifestPath);
          const loaded = await readRegistrySourceResource(source, resource);
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
              console.log(`${resource} is already at the latest version for ${harness} (${loaded.resource.version}).`);
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

          const applied = await applyResourceOperations(
            [{
              resource,
              harnesses: changed,
              action: 'install',
              resources: loaded.resources,
              warningResources: [loaded.resource, ...loaded.resources],
              version: loaded.resource.version,
            }],
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
      const choice = resourceArgument
        ? {
            resource: resourceArgument,
            resources: await installationResourceIds(resourceArgument, source),
          }
        : (
            interactiveTerminal
              ? await promptInstalledResource(installedRecords, source)
              : undefined
          );
      if (!choice) throw new Error('Resource ID is required. Pass it as the positional argument.');
      const resource = choice.resource;
      const resourceIds = choice.resources;
      const scope = isMcpResource(resource) ? parseScope(args.scope) : 'user';
      const harnesses = explicitHarnesses
        ? parseHarnesses(args.harness, rawArgs)
        : interactiveTerminal
          ? await promptInstalledHarnesses(installedRecords, resourceIds)
          : parseHarnesses(args.harness, rawArgs);

      if (!harnesses) throw new Error('Select at least one harness.');

      const interactive = interactiveTerminal && (!resourceArgument || !explicitHarnesses);
      const result = await withInteractiveForce(
        interactive,
        args.force ?? false,
        async (force) => {
          const manifestPath = installManifestPath(isMcpResource(resource) ? scope : 'user');
          const manifest = await readInstallationManifest(manifestPath);
          assertInstalledFor(manifest, resourceIds, harnesses, resource);

          if (isMcpResource(resource)) {
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

          const operation: ResourceOperation = {
            resource,
            harnesses,
            action: 'uninstall',
            resourceIds,
          };
          const plan = await planResourceOperations([operation], { cwd: process.cwd() }, force);
          let removeDependencies = args['remove-dependencies'] ?? false;
          if (plan.dependencyRemovals.length > 0 && interactiveTerminal && !removeDependencies) {
            removeDependencies = await promptToolDependencyRemoval(plan.dependencyRemovals) ?? false;
          }

          return applyResourceOperations(
            [operation],
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

async function ensureToolDependencies(
  resources: ResourceVersion[],
  interactive: boolean,
  allowInstall: boolean,
): Promise<boolean> {
  const statuses = await inspectToolDependencies(resources, { cwd: process.cwd() });
  const missing = statuses.filter((status) => !status.ready);

  if (missing.length === 0) return true;

  const approved = allowInstall || (
    interactive
      ? await promptToolDependencyInstall(missing) ?? false
      : false
  );

  if (!approved) {
    throw new Error(
      'Missing tool dependencies: ' +
      missing.map(dependencyStatusMessage).join('; ') +
      '. Re-run with --install-dependencies to install them using ' +
      [...new Set(missing.flatMap((status) => status.installCommands))].join(' or ') +
      '.',
    );
  }

  return true;
}

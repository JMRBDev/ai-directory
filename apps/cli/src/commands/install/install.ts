import { defineCommand } from 'citty';
import { resourceKey } from '@ai-directory/contracts';
import { applyMcpOperations, applyResourceOperations } from '@ai-directory/installers';
import {
  installManifestPath,
  isMcpResource,
  makeFileInstallOperation,
  makeMcpInstallOperation,
  resolveInstallScope,
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
import { promptHarnesses, promptResources } from '../../prompts';
import { ensureToolDependencies } from './shared';

export const install = defineCommand({
  meta: {
    name: 'install',
    description: 'Install one or more resources for one or more coding harnesses',
  },
  args: {
    resource: {
      type: 'positional',
      default: '',
      description: 'Resource ID: owner/type/name (repeat for more than one)',
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
      // SAFETY: citty parses every positional into `args._`; the named
      // `resource` positional holds the first one.
      const positionalExtras = (args as unknown as { _: string[] })._ ?? [];
      const resourceArguments = positionalExtras
        .map((item) => item.trim())
        .filter((item) => item && !item.startsWith('-'))
        .filter((item, index, items) => items.indexOf(item) === index);
      const selected = resourceArguments.length > 0
        ? resourceArguments
        : interactiveTerminal
          ? await promptResources(source)
          : undefined;
      if (!selected || selected.length === 0) {
        throw new Error('Resource ID is required. Pass one or more positional arguments.');
      }
      const explicitHarnesses = hasHarnessArgument(rawArgs);
      const harnesses = explicitHarnesses
        ? parseHarnesses(args.harness, rawArgs)
        : interactiveTerminal
          ? await promptHarnesses()
          : parseHarnesses(args.harness, rawArgs);

      if (!harnesses) throw new Error('Select at least one harness.');

      const scopeValue = parseScope(args.scope);
      // One atomic plan: resolve every resource first so a single apply call
      // plans, conflicts-checks, and installs the whole batch. Fail fast —
      // nothing is written unless the full plan applies.
      const fileTargets: Array<{ resource: string; loaded: Awaited<ReturnType<typeof readRegistrySourceResource>> }> = [];
      const mcpTargets: Array<{ resource: string; loaded: Awaited<ReturnType<typeof readRegistrySourceResource>>; scope: ReturnType<typeof parseScope> }> = [];
      for (const resource of selected) {
        const loaded = await readRegistrySourceResource(source, resource, args.version);
        const scope = resolveInstallScope(resource, scopeValue);
        const versions = [loaded.resource, ...loaded.resources];
        for (const version of versions) {
          if (version.resource.reviewStatus === 'unreviewed') {
            console.warn(
              `Warning: ${resourceKey(version.resource)}@${version.version} has not been reviewed.`,
            );
          }
        }
        if (isMcpResource(resource)) {
          mcpTargets.push({ resource, loaded, scope });
        } else {
          fileTargets.push({ resource, loaded });
        }
      }

      if (fileTargets.length > 0 && mcpTargets.length > 0) {
        throw new Error('Install MCP servers and file resources in separate commands.');
      }

      const installDependencies = await ensureToolDependencies(
        [...fileTargets, ...mcpTargets].flatMap((target) => [target.loaded.resource, ...target.loaded.resources]),
        isInteractiveTerminal(),
        args['install-dependencies'] ?? false,
      );

      const interactive = interactiveTerminal && (resourceArguments.length === 0 || !explicitHarnesses);
      const manifestPath = installManifestPath(
        mcpTargets.length > 0 ? mcpTargets[0]?.scope ?? 'user' : 'user',
      );

      const applied = await withInteractiveForce(
        interactive,
        args.force ?? false,
        async (force) => {
          if (mcpTargets.length > 0) {
            const scope = mcpTargets[0]?.scope ?? 'user';
            return applyMcpOperations(
              mcpTargets.map((target) =>
                makeMcpInstallOperation(target.resource, harnesses, scope, target.loaded, args.version),
              ),
              { cwd: process.cwd() },
              force,
            );
          }

          return applyResourceOperations(
            fileTargets.map((target) =>
              makeFileInstallOperation(target.resource, harnesses, target.loaded, args.version),
            ),
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

      const names = [...fileTargets, ...mcpTargets].map((target) =>
        `${resourceKey(target.loaded.resource.resource)}@${target.loaded.resource.version}`,
      );
      console.log(`Installed ${names.join(', ')} for ${harnesses.join(', ')}.`);
      console.log(`Tracked in: ${manifestPath}`);
    } catch (error) {
      reportError(error);
    }
  },
});

import type { ConfigScope } from '@ai-directory/config';
import type { Harness } from '@ai-directory/contracts';
import {
  dependencyStatusMessage,
  inspectToolDependencies,
  readInstallationManifest,
} from '@ai-directory/installers';
import {
  installManifestPath,
  installationResourceIds,
  isMcpResource,
  readInstallationPacks,
  readInstallationRecords,
} from '@ai-directory/server-core';
import type { RegistrySource, ResourceVersion } from '@ai-directory/registry';
import {
  hasHarnessArgument,
  isInteractiveTerminal,
  parseHarnesses,
  parseScope,
} from '../../helpers';
import {
  promptInstalledHarnesses,
  promptInstalledResource,
  promptToolDependencyInstall,
} from '../../prompts';

export type InstalledTarget = {
  resource: string;
  resourceIds: string[];
  scope: ConfigScope;
  harnesses: Harness[];
  interactive: boolean;
};

export async function resolveInstalledTarget(
  resourceArgument: string,
  scopeValue: string | undefined,
  harnessValue: string | undefined,
  rawArgs: string[],
  source: RegistrySource | undefined,
): Promise<InstalledTarget> {
  const interactiveTerminal = isInteractiveTerminal();
  const explicitHarnesses = hasHarnessArgument(rawArgs);
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
  const scope = isMcpResource(resource) ? parseScope(scopeValue) : 'user';
  const harnesses = explicitHarnesses
    ? parseHarnesses(harnessValue, rawArgs)
    : interactiveTerminal
      ? await promptInstalledHarnesses(installedRecords, resourceIds, installedPacks, resource)
      : parseHarnesses(harnessValue, rawArgs);

  if (!harnesses) throw new Error('Select at least one harness.');

  return {
    resource,
    resourceIds,
    scope,
    harnesses,
    interactive: interactiveTerminal && (!resourceArgument || !explicitHarnesses),
  };
}

export async function ensureToolDependencies(
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

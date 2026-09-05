import { resourceKey } from '@ai-directory/contracts';
import type { InstallOptions } from './install-types.js';
import type { ToolDependencyOptions } from './dependencies.js';
import type { ResourceOperation } from './resource-operation-types.js';
import type { ResourceChangeOptions } from './resource-operation-types.js';

export function operationInstallOptions(
  options: ResourceChangeOptions,
  force: boolean,
  dryRun = false,
  installationOwner?: string,
): InstallOptions {
  const result: InstallOptions = { force, dryRun };
  if (options.cwd) result.cwd = options.cwd;
  if (options.homeDirectory) result.homeDirectory = options.homeDirectory;
  if (options.scope) result.scope = options.scope;
  if (options.environment) result.environment = options.environment;
  if (installationOwner) result.installationOwner = installationOwner;

  return result;
}

export function dependencyOptionsFrom(options: ResourceChangeOptions): ToolDependencyOptions {
  const result: ToolDependencyOptions = {};
  if (options.cwd) result.cwd = options.cwd;
  if (options.environment) result.environment = options.environment;
  if (options.dependencyCommandRunner) result.commandRunner = options.dependencyCommandRunner;
  return result;
}

export function resourceIdsOf(operation: ResourceOperation): string[] {
  return operation.resourceIds
    ?? operation.resources?.map((resource) => resourceKey(resource.resource))
    ?? [];
}

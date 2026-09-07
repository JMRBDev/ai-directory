import type { ConfigScope } from '@ai-directory/config';
import type { RegistryIndex } from '@ai-directory/contracts';
import {
  aggregateRegistrySources,
  createCachedRegistry,
  type AggregatedRegistryResult,
  type RegistrySnapshot,
} from '@ai-directory/registry';
import type { ResourceChangeOptions } from '@ai-directory/installers';
import { registryEndpointFor, registryEndpoints } from './environment.js';
import type { ServerOptions } from './types.js';

export const cachedRegistry = createCachedRegistry();

export async function withRegistrySnapshot<T>(
  options: ServerOptions,
  cwd: string,
  action: (snapshot: RegistrySnapshot) => Promise<T>,
  registryId?: string,
): Promise<T> {
  const snapshot = await cachedRegistry.get(registryEndpointFor(options, cwd, registryId).source);
  return action(snapshot);
}

export async function aggregatedRegistry(
  options: ServerOptions,
  cwd: string,
): Promise<AggregatedRegistryResult> {
  const endpoints = registryEndpoints(options, cwd);
  if (endpoints.length === 0) {
    return { entries: [], registries: [], errors: [] };
  }
  // Cache snapshots per registry so one slow or failing registry cannot
  // block the rest. Aggregation reads indexes, never files, here.
  await Promise.all(
    endpoints.map((endpoint) => cachedRegistry.get(endpoint.source).catch(() => undefined)),
  );
  return aggregateRegistrySources(
    endpoints.map((endpoint) => ({ source: endpoint.source, registry: endpoint.identity })),
  );
}

export function changeOptions(
  options: ServerOptions,
  cwd: string,
  scope?: ConfigScope,
  dependencyOptions?: Pick<ResourceChangeOptions, 'installDependencies' | 'removeDependencies'>,
): ResourceChangeOptions {
  const result: ResourceChangeOptions = { cwd };
  if (options.homeDirectory) result.homeDirectory = options.homeDirectory;
  if (options.environment) result.environment = options.environment;
  if (scope) result.scope = scope;
  if (dependencyOptions?.installDependencies !== undefined) {
    result.installDependencies = dependencyOptions.installDependencies;
  }
  if (dependencyOptions?.removeDependencies !== undefined) {
    result.removeDependencies = dependencyOptions.removeDependencies;
  }
  if (options.dependencyCommandRunner) result.dependencyCommandRunner = options.dependencyCommandRunner;

  return result;
}

export type RegistryApiResponse = {
  index: RegistryIndex | null;
  source: 'local' | 'remote' | 'none';
  repository?: string;
  error?: string;
};

import type { ConfigScope } from '@ai-directory/config';
import type { RegistryIndex } from '@ai-directory/contracts';
import {
  createCachedRegistry,
  type RegistrySnapshot,
} from '@ai-directory/registry';
import type { ResourceChangeOptions } from '@ai-directory/installers';
import { registrySource } from './environment.js';
import type { ServerOptions } from './types.js';

export const cachedRegistry = createCachedRegistry();

export async function withRegistrySnapshot<T>(
  options: ServerOptions,
  cwd: string,
  action: (snapshot: RegistrySnapshot) => Promise<T>,
): Promise<T> {
  const snapshot = await cachedRegistry.get(registrySource(options, cwd));
  return action(snapshot);
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

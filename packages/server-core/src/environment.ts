import { resolve } from 'node:path';
import { getRepositorySetting } from '@ai-directory/config';
import {
  resolveRegistrySource,
  type RegistrySource,
  type RegistrySourceOptions,
} from '@ai-directory/registry';
import type { ServerOptions } from './types.js';

export function configResponse(cwd: string) {
  const setting = getRepositorySetting(undefined, cwd);

  return {
    repository: setting.value ?? null,
    source: setting.source,
  };
}

export function registrySource(options: ServerOptions, cwd: string): RegistrySource {
  const configuredIndex = options.registryIndexPath ?? process.env.AI_DIRECTORY_REGISTRY_INDEX;
  const indexPath = configuredIndex?.trim()
    ? resolve(cwd, configuredIndex.trim())
    : undefined;
  const repositoryValue = getRepositorySetting(undefined, cwd).value;
  const sourceOptions: RegistrySourceOptions = {};
  if (indexPath) sourceOptions.indexPath = indexPath;
  if (repositoryValue) sourceOptions.repositoryUrl = repositoryValue;

  return resolveRegistrySource(sourceOptions);
}

import { resolve } from 'node:path';
import { readRegistryEntries, type StoredRegistryEntry } from '@ai-directory/config';
import {
  resolveRegistrySource,
  type AggregatedRegistryIdentity,
  type RegistrySource,
  type RegistrySourceOptions,
} from '@ai-directory/registry';
import type { ServerOptions } from './types.js';

export type RegistryEndpoint = {
  id: string;
  source: RegistrySource;
  identity: AggregatedRegistryIdentity;
  scope: StoredRegistryEntry['scope'];
};

export function configResponse(cwd: string) {
  const registries = readRegistryEntries(cwd).map((entry) => ({
    id: entry.id,
    url: entry.url,
    branch: entry.branch ?? 'main',
    scope: entry.scope,
    enabled: entry.enabled !== false,
  }));

  return {
    repository: registries[0]?.url ?? null,
    source: registries.length > 0 ? registries[0]?.scope ?? 'none' : 'none',
    registries,
  };
}

export function registryEndpoints(options: ServerOptions, cwd: string): RegistryEndpoint[] {
  const configuredIndex = options.registryIndexPath ?? process.env.AI_DIRECTORY_REGISTRY_INDEX;
  const indexPath = configuredIndex?.trim()
    ? resolve(cwd, configuredIndex.trim())
    : undefined;
  if (indexPath) {
    return [{
      id: 'local-index',
      source: resolveRegistrySource({ indexPath }),
      identity: { id: 'local-index' },
      scope: 'user',
    }];
  }

  return readRegistryEntries(cwd)
    .filter((entry) => entry.enabled !== false)
    .map((entry) => {
      const sourceOptions: RegistrySourceOptions = {
        repositoryUrl: entry.url,
        baseBranch: entry.branch ?? 'main',
      };
      return {
        id: entry.id,
        source: resolveRegistrySource(sourceOptions),
        identity: { id: entry.id, url: entry.url, branch: entry.branch ?? 'main' },
        scope: entry.scope,
      };
    });
}

export function registrySource(options: ServerOptions, cwd: string): RegistrySource {
  const endpoints = registryEndpoints(options, cwd);
  const first = endpoints[0];
  if (!first) {
    return resolveRegistrySource({});
  }
  return first.source;
}

export function registryEndpointFor(
  options: ServerOptions,
  cwd: string,
  id: string | undefined,
): RegistryEndpoint {
  const endpoints = registryEndpoints(options, cwd);
  if (endpoints.length === 0) {
    throw new Error('No registry source configured. Run `aid setup` or pass `--index <path>`.');
  }
  if (!id?.trim()) {
    const first = endpoints[0];
    if (!first) throw new Error('No registry source configured.');
    return first;
  }
  const normalized = id.trim().toLowerCase();
  const match = endpoints.find((entry) => entry.id === normalized);
  if (!match) throw new Error(`Unknown registry: ${id}.`);
  return match;
}

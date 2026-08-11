import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getRepositorySetting } from '@ai-directory/config';
import {
  readRegistryIndex,
  readResourceVersion,
  readRemoteRegistryIndex,
  readRemoteResource,
  type ResourceVersion,
} from '@ai-directory/registry';
import type { RegistryIndex, ResourceSummary } from '@ai-directory/contracts';

export type LocalRegistry = {
  index: RegistryIndex | null;
  indexPath: string;
  source: 'local' | 'remote';
  repository?: string;
  error?: string;
};

function findWorkspaceRoot(startDirectory: string): string | null {
  let directory = resolve(startDirectory);

  while (true) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;

    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function getConfigCwd(): string {
  return (
    process.env.AI_DIRECTORY_CONFIG_CWD ??
    findWorkspaceRoot(process.cwd()) ??
    process.cwd()
  );
}

export function getRegistryIndexPath(): string {
  return resolve(
    process.env.AI_DIRECTORY_REGISTRY_INDEX ??
      resolve(process.cwd(), '../../.ai-directory/registry/index.json'),
  );
}

export function resourceId(resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>): string {
  return `${resource.owner}/${resource.type}/${resource.name}`;
}

export async function loadLocalRegistry(): Promise<LocalRegistry> {
  const indexPath = getRegistryIndexPath();

  try {
    return { index: await readRegistryIndex(indexPath), indexPath, source: 'local' };
  } catch (error) {
    const localError = error instanceof Error ? error.message : String(error);
    const repository = getRepositorySetting(undefined, getConfigCwd()).value;

    if (!repository) {
      return { index: null, indexPath, source: 'local', error: localError };
    }

    try {
      return {
        index: await readRemoteRegistryIndex({ repositoryUrl: repository }),
        indexPath,
        source: 'remote',
        repository,
      };
    } catch (remoteError) {
      const message = remoteError instanceof Error ? remoteError.message : String(remoteError);
      return {
        index: null,
        indexPath,
        source: 'remote',
        repository,
        error: `Local registry unavailable: ${localError}\nRemote registry unavailable: ${message}`,
      };
    }
  }
}

export async function loadLocalResource(
  indexPath: string,
  resource: ResourceSummary,
  repository?: string,
): Promise<{ version: ResourceVersion | null; error?: string }> {
  try {
    return {
      version: repository
        ? (await readRemoteResource({
            repositoryUrl: repository,
            resourceId: resourceId(resource),
            version: resource.latestVersion,
          })).resource
        : await readResourceVersion(indexPath, resourceId(resource), resource.latestVersion),
    };
  } catch (error) {
    return {
      version: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

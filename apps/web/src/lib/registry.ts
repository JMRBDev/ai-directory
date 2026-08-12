import { resolve } from 'node:path';
import { findWorkspaceRoot, getRepositorySetting } from '@ai-directory/config';
import {
  readRegistrySourceIndex,
  readRegistrySourceResource,
  resolveRegistrySource,
  type ResourceVersion,
} from '@ai-directory/registry';
import type { RegistryIndex, ResourceSummary } from '@ai-directory/contracts';

export type RegistryView = {
  index: RegistryIndex | null;
  indexPath?: string;
  source: 'local' | 'remote';
  repository?: string;
  error?: string;
};

function getConfigCwd(): string {
  return (
    process.env.AI_DIRECTORY_CONFIG_CWD ??
    findWorkspaceRoot(process.cwd()) ??
    process.cwd()
  );
}

export function getRegistryIndexPath(): string | undefined {
  const path = process.env.AI_DIRECTORY_REGISTRY_INDEX?.trim();
  return path
    ? resolve(process.env.AI_DIRECTORY_CONFIG_CWD ?? process.cwd(), path)
    : undefined;
}

export function resourceId(resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>): string {
  return `${resource.owner}/${resource.type}/${resource.name}`;
}

export async function loadRegistry(): Promise<RegistryView> {
  const indexPath = getRegistryIndexPath();
  const repository = getRepositorySetting(undefined, getConfigCwd()).value;

  try {
    const source = resolveRegistrySource({
      ...(indexPath ? { indexPath } : {}),
      ...(repository ? { repositoryUrl: repository } : {}),
    });

    return {
      index: await readRegistrySourceIndex(source),
      ...(source.type === 'local'
        ? { indexPath: source.indexPath }
        : { repository: source.repositoryUrl }),
      source: source.type,
    };
  } catch (error) {
    return {
      index: null,
      ...(indexPath ? { indexPath } : {}),
      ...(repository ? { repository } : {}),
      source: indexPath ? 'local' : 'remote',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadResource(
  indexPath: string | undefined,
  resource: ResourceSummary,
  repository?: string,
): Promise<{ version: ResourceVersion | null; resources: ResourceVersion[]; error?: string }> {
  try {
    const source = resolveRegistrySource({
      ...(indexPath ? { indexPath } : {}),
      ...(repository ? { repositoryUrl: repository } : {}),
    });

    const result = await readRegistrySourceResource(source, resourceId(resource), resource.latestVersion);
    return { version: result.resource, resources: result.resources };
  } catch (error) {
    return {
      version: null,
      resources: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

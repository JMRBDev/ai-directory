import { resolve } from 'node:path';
import {
  readRegistryIndex,
  readResourceVersion,
  type ResourceVersion,
} from '@ai-directory/registry';
import type { RegistryIndex, ResourceSummary } from '@ai-directory/contracts';

export type LocalRegistry = {
  index: RegistryIndex | null;
  indexPath: string;
  error?: string;
};

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
    return { index: await readRegistryIndex(indexPath), indexPath };
  } catch (error) {
    return {
      index: null,
      indexPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadLocalResource(
  indexPath: string,
  resource: ResourceSummary,
): Promise<{ version: ResourceVersion | null; error?: string }> {
  try {
    return {
      version: await readResourceVersion(indexPath, resourceId(resource), resource.latestVersion),
    };
  } catch (error) {
    return {
      version: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

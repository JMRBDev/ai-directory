import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { ResourceType, ResourceSummary } from '@ai-directory/contracts';

export function resourceDirectory(
  registryRoot: string,
  resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>,
  version: string,
): string {
  return join(registryRoot, resourcePackagePath(resource, version));
}

export function resourcePackagePath(
  resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>,
  version: string,
): string {
  return join('resources', resource.owner, resource.type, resource.name, version);
}

export function parseResourceId(resourceId: string): Pick<ResourceSummary, 'owner' | 'type' | 'name'> {
  const parts = resourceId.split('/');

  // SAFETY: Callers validate resourceId against resourceIdSchema first, which
  // requires exactly owner/type/name as non-empty slug segments.
  return {
    owner: parts[0] as string,
    type: parts[1] as ResourceType,
    name: parts[2] as string,
  };
}

export async function resolveDirectory(path: string, label: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throw new Error(`${label} not found: ${path}`, { cause: error });
  }
}
